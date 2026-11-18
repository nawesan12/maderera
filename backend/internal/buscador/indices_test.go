package buscador

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// anotador es un Consultor que, además de consultar, guarda cada consulta
// con sus argumentos para pedirle el plan después.
type anotador struct {
	pool      *pgxpool.Pool
	consultas []consulta
}

type consulta struct {
	sql  string
	args []any
}

func (a *anotador) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	a.consultas = append(a.consultas, consulta{sql, args})
	return a.pool.Query(ctx, sql, args...)
}

// plan es el EXPLAIN de una consulta, con lo que se pida apagado.
func plan(t *testing.T, pool *pgxpool.Pool, c consulta, apagar ...string) string {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	for _, a := range apagar {
		if _, err := tx.Exec(ctx, "SET LOCAL "+a+" = off"); err != nil {
			t.Fatal(err)
		}
	}
	filas, err := tx.Query(ctx, "EXPLAIN "+c.sql, c.args...)
	if err != nil {
		t.Fatal(err)
	}
	lineas, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	return strings.Join(lineas, "\n")
}

// Cada consulta del buscador tiene un índice para cada una de sus ramas.
//
// Con el barrido secuencial y el recorrido de índices apagados, a Postgres
// solo le queda el bitmap, que necesita una condición indexada: si una rama
// del OR no tiene índice (o la expresión del índice no es letra por letra la
// de busqueda.Digitos), el plan vuelve a «Seq Scan» igual. Esto prueba que el
// índice **se puede** usar; que el planificador lo **elija** lo prueba
// TestElPlanificadorEligeElIndice, con datos.
func TestCadaConsultaTieneSuIndice(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	admin := sqlc.StaffRoleAdmin
	for _, busco := range []string{"nandu perez", "2235551234", "0003-0000"} {
		a := &anotador{pool: pool}
		if _, err := Buscar(ctx, a, &admin, busco); err != nil {
			t.Fatal(err)
		}
		if len(a.consultas) != 6 {
			t.Fatalf("%q: %d consultas", busco, len(a.consultas))
		}
		for _, c := range a.consultas {
			p := plan(t, pool, c, "enable_seqscan", "enable_indexscan")
			if strings.Contains(p, "Seq Scan") {
				t.Errorf("%q recorre la tabla:\n%s\n%s", busco, c.sql, p)
			}
		}
	}
}

// Con un padrón del tamaño del de ISIS y años de pedidos, el planificador va
// por el índice sin que nadie lo obligue: un teléfono, un nombre y un número
// de pedido. Con pocas filas elige recorrer la tabla, y está bien (es más
// barato); por eso son 100.000 pedidos: los trigramas de dígitos se repiten
// mucho y el índice recién gana cuando la tabla es grande, que es justo
// cuando importa.
func TestElPlanificadorEligeElIndice(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	// Los GIN se sacan y se vuelven a crear tal cual los dejó la migración:
	// armarlos de una vez con los datos adentro es mucho más rápido
	// que mantenerlos fila por fila.
	filas, err := pool.Query(ctx, `SELECT indexname, indexdef FROM pg_indexes
		WHERE tablename IN ('customers', 'orders') AND indexdef LIKE '%USING gin%'`)
	if err != nil {
		t.Fatal(err)
	}
	type indice struct{ Nombre, Definicion string }
	indices, err := pgx.CollectRows(filas, pgx.RowToStructByPos[indice])
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range indices {
		if _, err := pool.Exec(ctx, `DROP INDEX `+i.Nombre); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO customers (nombre, telefono, cuit)
		SELECT 'Cliente ' || md5(i::text), '223 ' || lpad((i * 7919 % 10000000)::text, 7, '0'), '20' || lpad(i::text, 8, '0') || '9'
		FROM generate_series(1, 20000) i;
		INSERT INTO orders (numero, contacto_nombre, origen, contacto_telefono, created_at)
		SELECT 'PED-' || lpad(i::text, 6, '0'), 'Contacto', 'mostrador', '0223 15 ' || lpad((i::bigint * 104729 % 10000000)::text, 7, '0'),
		       now() - (i || ' minutes')::interval
		FROM generate_series(1, 100000) i;
`); err != nil {
		t.Fatal(err)
	}
	for _, i := range indices {
		if _, err := pool.Exec(ctx, i.Definicion); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `ANALYZE customers; ANALYZE orders`); err != nil {
		t.Fatal(err)
	}
	admin := sqlc.StaffRoleAdmin
	for _, busco := range []string{"2235551234", "c4ca4238a0", "PED-001234"} {
		a := &anotador{pool: pool}
		if _, err := Buscar(ctx, a, &admin, busco); err != nil {
			t.Fatal(err)
		}
		for _, c := range a.consultas[:2] { // clientes y pedidos
			if p := plan(t, pool, c); strings.Contains(p, "Seq Scan") {
				t.Errorf("%q recorre la tabla:\n%s\n%s", busco, c.sql, p)
			}
		}
	}
}

// Dos letras no buscan en las tablas: los trigramas no tienen de dónde
// agarrarse y se recorría todo en cada tecla. «Juan de la» busca «juan».
func TestLoCortoNoBusca(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `insert into customers (nombre) values ('Juan de la Cruz')`)
	admin := sqlc.StaffRoleAdmin
	a := &anotador{pool: pool}
	if r, err := Buscar(ctx, a, &admin, "de"); err != nil || len(r) != 0 || len(a.consultas) != 0 {
		t.Errorf("«de» buscó: %v %v %d", r, err, len(a.consultas))
	}
	r, err := Buscar(ctx, pool, &admin, "juan de la")
	if err != nil || len(r) != 1 {
		t.Errorf("«juan de la»: %v %v", r, err)
	}
}
