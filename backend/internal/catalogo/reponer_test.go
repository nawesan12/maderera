package catalogo

import (
	"context"
	"testing"

	"mjbj/internal/pruebas"
)

// M4-079: con la regla en «las_que_la_manejan», el mínimo de la sucursal
// que nunca tuvo la medida no la pide; con la de arranque, sí.
func TestReponerSoloDondeSeManeja(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	var cat, prod, v, central, aserradero string
	q := func(dst *string, sql string, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(dst); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	q(&cat, `insert into categories (slug, name, description) values ('pinturas', 'Pinturas', '') returning id`)
	q(&prod, `insert into products (slug, name, category_id, description, unit) values ('laca', 'Laca', $1, '', 'litro') returning id`, cat)
	q(&v, `insert into product_variants (product_id, sku, label) values ($1, 'LACA1', '1 L') returning id`, prod)
	q(&central, `insert into branches (slug, name, sort_order) values ('casa-central', 'Casa Central', 1) returning id`)
	q(&aserradero, `insert into branches (slug, name, sort_order) values ('aserradero', 'Aserradero', 2) returning id`)
	if _, err := pool.Exec(ctx, `insert into inventory (variant_id, branch_id, qty, min_qty) values ($1, $2, 32, 10), ($1, $3, 0, 6)`, v, central, aserradero); err != nil {
		t.Fatal(err)
	}
	cuantas := func() int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `select count(*)::int from inventory i where `+ReponerEnFila).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := cuantas(); n != 1 {
		t.Errorf("con la regla de arranque, el Aserradero pide: %d", n)
	}
	if _, err := pool.Exec(ctx, `insert into site_settings (clave, valor) values ('reponer_por_sucursal', 'las_que_la_manejan')
		on conflict (clave) do update set valor = excluded.valor`); err != nil {
		t.Fatal(err)
	}
	if n := cuantas(); n != 0 {
		t.Errorf("el Aserradero nunca tuvo laca y la pide: %d", n)
	}
	// Si la tuvo y se le terminó, vuelve a pedirla.
	if _, err := pool.Exec(ctx, `insert into inventory_movements (variant_id, branch_id, type, qty, note) values ($1, $2, 'egreso', -2, 'venta')`, v, aserradero); err != nil {
		t.Fatal(err)
	}
	if n := cuantas(); n != 1 {
		t.Errorf("la que la movió no la pide: %d", n)
	}
}
