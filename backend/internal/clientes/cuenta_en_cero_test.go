package clientes

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/pruebas"
)

// ceroDeLaFicha es lo que el trigger de la 00201 guardó en cada cliente.
func ceroDeLaFicha(t *testing.T, pool *pgxpool.Pool) map[string]string {
	t.Helper()
	filas, err := pool.Query(context.Background(), `SELECT id::text, coalesce(cuenta_en_cero_id::text, '') FROM customers`)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	var id, cero string
	if _, err := pgx.ForEachRow(filas, []any{&id, &cero}, func() error { out[id] = cero; return nil }); err != nil {
		t.Fatal(err)
	}
	return out
}

// ceroDesdeElPrincipio es el último cero calculado sobre la cuenta entera,
// como lo buscaba la ventana de antes.
func ceroDesdeElPrincipio(t *testing.T, pool *pgxpool.Pool) map[string]string {
	t.Helper()
	filas, err := pool.Query(context.Background(), `
		SELECT c.id::text, coalesce(z.id::text, '') FROM customers c LEFT JOIN (
		  SELECT DISTINCT ON (customer_id) customer_id, id FROM (
		    SELECT customer_id, created_at, id, sum(monto) OVER (PARTITION BY customer_id ORDER BY created_at, id) AS acumulado
		    FROM account_movements) m
		  WHERE acumulado = 0 ORDER BY customer_id, created_at DESC, id DESC) z ON z.customer_id = c.id`)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	var id, cero string
	if _, err := pgx.ForEachRow(filas, []any{&id, &cero}, func() error { out[id] = cero; return nil }); err != nil {
		t.Fatal(err)
	}
	return out
}

// mismaCartera compara el cero guardado contra el calculado y la cartera
// contra la cuenta de antes (todos los movimientos de todos).
func mismaCartera(t *testing.T, pool *pgxpool.Pool, s *Servicio, paso string) {
	t.Helper()
	guardado, calculado := ceroDeLaFicha(t, pool), ceroDesdeElPrincipio(t, pool)
	for id, c := range calculado {
		if guardado[id] != c {
			t.Errorf("%s: el cero de %s es %q y la cuenta dice %q", paso, id, guardado[id], c)
		}
	}
	esperado := cuentaDeAntes(t, pool)
	c, err := s.Listar(context.Background(), FiltrosDeClientes{}, hoyDeLaCartera)
	if err != nil {
		t.Fatal(err)
	}
	if c.CantidadDeudores != len(esperado.deudores) || c.DeudaTotal != esperado.deuda || c.VencidoTotal != esperado.vencido {
		t.Fatalf("%s: %d %v %v, antes %d %v %v", paso, c.CantidadDeudores, c.DeudaTotal, c.VencidoTotal,
			len(esperado.deudores), esperado.deuda, esperado.vencido)
	}
	for _, x := range c.PorCobrar {
		antes := esperado.deudores[x.ID]
		if antes == nil || x.Deuda.Vencido != antes.Vencido || dias(x.Deuda.DiasDeLaMasVieja) != dias(antes.DiasDeLaMasVieja) ||
			x.Deuda.Prioridad != antes.Prioridad {
			t.Errorf("%s: %s %+v, antes %+v", paso, x.Nombre, *x.Deuda, antes)
		}
	}
}

// El último saldo cero de cada cliente lo mantiene un trigger: con cada
// forma en que se escribe la cuenta corriente, el cero guardado es el de la
// cuenta entera y la cartera da lo mismo que sumando todo.
func TestCuentaEnCeroSeMantiene(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, silencio)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	movimiento := func(cliente string, monto float64, dias int) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'ajuste', $2, $3) returning id`,
			cliente, monto, hoyDeLaCartera.AddDate(0, 0, -dias)).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	// Paga todo y vuelve a comprar: el cero es el pago.
	ana := cliente(t, pool, "Ana", "", [2]float64{1000, 90}, [2]float64{-1000, 60}, [2]float64{500, 20})
	// Nunca llegó a cero.
	beto := cliente(t, pool, "Beto", "", [2]float64{700, 100}, [2]float64{-200, 50})
	// Al día.
	cliente(t, pool, "Carla", "", [2]float64{300, 40}, [2]float64{-300, 30})
	mismaCartera(t, pool, s, "altas")

	// Un pago con fecha vieja, antes del cero: se recorre la cuenta entera.
	movimiento(ana, -100, 75)
	mismaCartera(t, pool, s, "pago con fecha vieja")
	// Y lo que lo compensa, al final: un cero nuevo.
	movimiento(ana, -400, 10)
	mismaCartera(t, pool, s, "un cero nuevo al final")

	// Varios clientes en una sola sentencia, fuera de orden.
	exec(`insert into account_movements (customer_id, tipo, monto, created_at) values
		($1, 'pago', -500, $3), ($2, 'compra', 50, $4), ($1, 'compra', 80, $5)`,
		beto, ana, hoyDeLaCartera.AddDate(0, 0, -5), hoyDeLaCartera.AddDate(0, 0, -3), hoyDeLaCartera.AddDate(0, 0, -1))
	mismaCartera(t, pool, s, "varios en una sentencia")

	// Cambiar el monto mueve el cero; cambiar el detalle no toca nada.
	pago := movimiento(beto, -80, 0)
	mismaCartera(t, pool, s, "beto en cero")
	exec(`update account_movements set monto = -79 where id = $1`, pago)
	mismaCartera(t, pool, s, "cambió el monto")
	exec(`update account_movements set detalle = 'corregido' where customer_id = $1`, beto)
	mismaCartera(t, pool, s, "cambió el detalle")

	// Borrar el movimiento del cero (la baja de una factura borra).
	var cero string
	if err := pool.QueryRow(ctx, `select cuenta_en_cero_id::text from customers where id = $1`, ana).Scan(&cero); err != nil || cero == "" {
		t.Fatalf("ana sin cero: %v", err)
	}
	exec(`delete from account_movements where id = $1`, cero)
	mismaCartera(t, pool, s, "borrado el cero")

	// Unir dos fichas mueve la cuenta de una a la otra.
	exec(`update account_movements set customer_id = $1 where customer_id = $2`, beto, ana)
	mismaCartera(t, pool, s, "unión de fichas")
}

// Dos movimientos del mismo cliente a la vez: el segundo espera al primero y
// ve lo que escribió. Sin el candado, el pago de 100 sumado sin la compra de
// 50 que todavía no se confirmaba dejaba un cero que no existe, y la cartera
// perdía esa compra.
func TestCuentaEnCeroConDosALaVez(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, silencio)
	id := cliente(t, pool, "Dora", "", [2]float64{100, 30})
	a, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Rollback(ctx)
	if _, err := a.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'compra', 50, $2)`,
		id, hoyDeLaCartera.AddDate(0, 0, -2)); err != nil {
		t.Fatal(err)
	}
	listo := make(chan error, 1)
	go func() {
		_, err := pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'pago', -100, $2)`,
			id, hoyDeLaCartera.AddDate(0, 0, -1))
		listo <- err
	}()
	select {
	case err := <-listo:
		t.Fatalf("el segundo no esperó al primero: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	if err := a.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-listo; err != nil {
		t.Fatal(err)
	}
	mismaCartera(t, pool, s, "dos a la vez")
	var cero *string
	if err := pool.QueryRow(ctx, `select cuenta_en_cero_id::text from customers where id = $1`, id).Scan(&cero); err != nil || cero != nil {
		t.Errorf("Dora debe 50 y nunca estuvo en cero: %v %v", cero, err)
	}
}
