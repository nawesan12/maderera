package revalidar

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/pruebas"
)

// Las pruebas del trigger de la 00169: cuando el stock cambia, queda un solo
// aviso pendiente para Next con las etiquetas de lo que cambió.

type sembrado struct {
	pool             *pgxpool.Pool
	central          string
	fenolico, clavos string // variantes
	otrasCategorias  []string
}

func sembrar(t *testing.T) sembrado {
	t.Helper()
	pool := pruebas.Base(t)
	ctx := context.Background()
	q := func(sql string, args ...any) string {
		var id string
		if err := pool.QueryRow(ctx, sql, args...).Scan(&id); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	s := sembrado{pool: pool}
	s.central = q(`insert into branches (slug, name) values ('casa-central', 'Casa Central') returning id`)
	placas := q(`insert into categories (slug, name) values ('placas', 'Placas') returning id`)
	ferre := q(`insert into categories (slug, name) values ('ferreteria', 'Ferretería') returning id`)
	fen := q(`insert into products (slug, name, category_id, description) values ('fenolico', 'Fenólico', $1, '') returning id`, placas)
	cla := q(`insert into products (slug, name, category_id, description) values ('clavos', 'Clavos', $1, '') returning id`, ferre)
	s.fenolico = q(`insert into product_variants (product_id, sku, label) values ($1, 'FEN18', '18 mm') returning id`, fen)
	s.clavos = q(`insert into product_variants (product_id, sku, label) values ($1, 'CLA', '1 kg') returning id`, cla)
	return s
}

type aviso struct {
	ID        string
	Etiquetas []string
	En        time.Time
}

func pendientes(t *testing.T, pool *pgxpool.Pool) []aviso {
	t.Helper()
	filas, err := pool.Query(context.Background(), `SELECT id::text, carga, proximo_intento_at FROM trabajos
		WHERE tipo = 'next.revalidar' AND estado = 'pendiente' AND carga->>'agrupa' = 'stock' ORDER BY created_at`)
	if err != nil {
		t.Fatal(err)
	}
	defer filas.Close()
	var out []aviso
	for filas.Next() {
		var a aviso
		var carga []byte
		if err := filas.Scan(&a.ID, &carga, &a.En); err != nil {
			t.Fatal(err)
		}
		var c Aviso
		_ = json.Unmarshal(carga, &c)
		a.Etiquetas = c.Etiquetas
		out = append(out, a)
	}
	return out
}

func TestElStockAvisaAlCatalogo(t *testing.T) {
	s := sembrar(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := s.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}

	// Entra stock del fenólico: un aviso, para dentro de dos minutos, con la
	// categoría, la ficha y el listado de todo.
	exec(`insert into inventory (variant_id, branch_id, qty) values ($1, $2, 10)`, s.fenolico, s.central)
	p := pendientes(t, s.pool)
	if len(p) != 1 || !slices.Equal(p[0].Etiquetas, []string{"catalogo:placas", "catalogo:todo", "producto:fenolico"}) {
		t.Fatalf("después del alta: %+v", p)
	}
	if espera := time.Until(p[0].En); espera < 90*time.Second || espera > 150*time.Second {
		t.Errorf("el aviso sale en %s", espera)
	}

	// Una venta de otro producto, en otra transacción: se suma al mismo aviso.
	exec(`insert into inventory (variant_id, branch_id, qty) values ($1, $2, 5)`, s.clavos, s.central)
	exec(`update inventory set qty = qty - 1 where variant_id = $1`, s.fenolico)
	p = pendientes(t, s.pool)
	if len(p) != 1 || !slices.Equal(p[0].Etiquetas,
		[]string{"catalogo:ferreteria", "catalogo:placas", "catalogo:todo", "producto:clavos", "producto:fenolico"}) {
		t.Fatalf("dos cambios: %+v", p)
	}

	// Tocar una fila sin cambiar el stock (recalcular el reservado cuando ya
	// está bien) no avisa nada.
	exec(`delete from trabajos where carga->>'agrupa' = 'stock'`)
	exec(`update inventory set updated_at = now()`)
	if p := pendientes(t, s.pool); len(p) != 0 {
		t.Errorf("sin cambios avisó: %+v", p)
	}

	// El worker ya tomó el aviso: lo que cambie ahora va en uno nuevo, no se
	// pierde en el que se está mandando.
	exec(`update inventory set reservado = 1 where variant_id = $1`, s.clavos)
	exec(`update trabajos set estado = 'procesando', intentos = 1 where carga->>'agrupa' = 'stock'`)
	exec(`update inventory set reservado = 0 where variant_id = $1`, s.clavos)
	if p := pendientes(t, s.pool); len(p) != 1 || !slices.Contains(p[0].Etiquetas, "producto:clavos") {
		t.Errorf("con el anterior tomado: %+v", p)
	}
}

// Una venta no espera a otra por el aviso: si el pendiente está tomado por
// otra transacción, deja el suyo. Esperar ahí cruzaba los candados del aviso
// con los del stock.
func TestElAvisoNoHaceEsperar(t *testing.T) {
	s := sembrar(t)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `insert into inventory (variant_id, branch_id, qty) values ($1, $2, 10), ($3, $2, 10)`,
		s.fenolico, s.central, s.clavos); err != nil {
		t.Fatal(err)
	}
	// La venta A mueve el fenólico y queda abierta: tiene tomado el aviso.
	a, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Rollback(ctx)
	if _, err := a.Exec(ctx, `update inventory set qty = qty - 1 where variant_id = $1`, s.fenolico); err != nil {
		t.Fatal(err)
	}
	// La venta B mueve los clavos sin esperar a A.
	b, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Rollback(ctx)
	if _, err := b.Exec(ctx, `SET LOCAL lock_timeout = '1s'`); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Exec(ctx, `update inventory set qty = qty - 1 where variant_id = $1`, s.clavos); err != nil {
		t.Fatalf("B esperó a A: %v", err)
	}
	if err := b.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := a.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var todas []string
	for _, p := range pendientes(t, s.pool) {
		todas = append(todas, p.Etiquetas...)
	}
	if !slices.Contains(todas, "producto:clavos") || !slices.Contains(todas, "producto:fenolico") {
		t.Errorf("se perdió un aviso: %v", todas)
	}
}

// Un cambio masivo (la migración de ISIS, un ajuste de todo) avisa
// «catalogo» entero en vez de doscientas etiquetas.
func TestMuchasEtiquetasSeVuelvenUna(t *testing.T) {
	s := sembrar(t)
	ctx := context.Background()
	var cat string
	if err := s.pool.QueryRow(ctx, `select id from categories where slug = 'placas'`).Scan(&cat); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, fmt.Sprintf(`
		WITH p AS (
		  INSERT INTO products (slug, name, category_id, description)
		  SELECT 'p' || i, 'P ' || i, '%s', '' FROM generate_series(1, 250) i RETURNING id
		), v AS (
		  INSERT INTO product_variants (product_id, sku, label) SELECT id, id::text, 'u' FROM p RETURNING id
		)
		INSERT INTO inventory (variant_id, branch_id, qty) SELECT id, '%s', 1 FROM v`, cat, s.central)); err != nil {
		t.Fatal(err)
	}
	if p := pendientes(t, s.pool); len(p) != 1 || !slices.Equal(p[0].Etiquetas, []string{"catalogo"}) {
		t.Errorf("masivo: %+v", p)
	}
}
