package catalogo

import (
	"context"
	"testing"
)

// Mes 23: «pino 2x4» trae el tirante de 2" x 4" y no el machimbre de
// 1/2" x 4" (el bot lo ponía primero); la ficha trae el precio de antes de
// una oferta vigente para tacharlo, y no el de una vencida.
func TestMedidaDeCorridoYOfertaEnLaFicha(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	q := func(sql string, args ...any) string {
		var id string
		if err := e.pool.QueryRow(ctx, sql, args...).Scan(&id); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	cat := q(`insert into categories (slug, name, description) values ('maderas', 'Maderas', '') returning id`)
	tir := q(`insert into products (slug, name, category_id, description) values ('tirante', 'Tirante Pino Tratado', $1, '') returning id`, cat)
	mac := q(`insert into products (slug, name, category_id, description) values ('machimbre', 'Machimbre Pino', $1, '') returning id`, cat)
	v24 := q(`insert into product_variants (product_id, sku, label, sort_order) values ($1, 'T24', '2" x 4" x 3.60m', 1) returning id`, tir)
	v26 := q(`insert into product_variants (product_id, sku, label, sort_order) values ($1, 'T26', '2" x 6" x 4.20m', 2) returning id`, tir)
	vm := q(`insert into product_variants (product_id, sku, label) values ($1, 'M124', '1/2" x 4"') returning id`, mac)
	gen := q(`insert into price_lists (slug, name, is_default) values ('general', 'General', true) returning id`)
	_ = q(`insert into price_list_items (price_list_id, variant_id, price, precio_anterior, oferta_hasta) values
		($1, $2, 30000, 35200, now() + interval '3 days'), ($1, $3, 40000, 45000, now() - interval '1 day'), ($1, $4, 9000, null, null) returning id`, gen, v24, v26, vm)

	general, err := Nuevo(e.pool).General(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range []string{"pino 2x4", "2x4", "Tirante 2X4"} {
		ps, err := Nuevo(e.pool).Claves(ctx, Filtros{Busqueda: b, Limite: 20}, general)
		if err != nil || len(ps) != 1 || ps[0].Slug != "tirante" {
			t.Errorf("%q: %+v %v", b, ps, err)
		}
	}

	p, err := Nuevo(e.pool).Producto(ctx, "tirante", general)
	if err != nil || p == nil || len(p.Variantes) != 2 {
		t.Fatalf("%+v %v", p, err)
	}
	if a := p.Variantes[0].PrecioAnterior; a == nil || *a != "35200.00" {
		t.Errorf("la vigente: %v", a)
	}
	if a := p.Variantes[1].PrecioAnterior; a != nil {
		t.Errorf("la vencida: %v", *a)
	}
}
