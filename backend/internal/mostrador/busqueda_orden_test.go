package mostrador

import (
	"context"
	"testing"
)

// Mes simulado (H041, H039): «laca» traía primero los fenólicos (la categoría
// «Placas» contiene «laca») y la laca recién después; y el resultado no
// decía nada del costo.
func TestLaBusquedaPoneElNombrePrimeroYTraeElPiso(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	var cat, laca, variante string
	_ = e.pool.QueryRow(ctx, `insert into categories (slug, name, description) values ('ferreteria', 'Ferretería', '') returning id`).Scan(&cat)
	_ = e.pool.QueryRow(ctx, `insert into products (slug, name, category_id, description, unit) values ('laca', 'Laca Poliuretánica', $1, '', 'unidad') returning id`, cat).Scan(&laca)
	_ = e.pool.QueryRow(ctx, `insert into product_variants (product_id, sku, label) values ($1, 'LAC4', '4 litros') returning id`, laca).Scan(&variante)
	if _, err := e.pool.Exec(ctx, `insert into variant_costs (variant_id, cantidad_base, costo_promedio) values ($1, 1, 75000)`, e.placa); err != nil {
		t.Fatal(err)
	}

	r, err := e.svc.Buscar(ctx, "laca", e.central, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(r) < 2 || r[0].VariantID != variante {
		t.Fatalf("la laca no va primero: %+v", r)
	}

	r, err = e.svc.Buscar(ctx, "fenolico", e.central, nil)
	if err != nil || len(r) != 1 {
		t.Fatalf("fenólico: %v %+v", err, r)
	}
	// 75.000 neto + 21 % de IVA.
	if r[0].Piso == nil || *r[0].Piso != 90750 {
		t.Errorf("piso del fenólico: %v", r[0].Piso)
	}
}
