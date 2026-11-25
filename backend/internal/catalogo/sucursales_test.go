package catalogo

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

// Una tercera sucursal activa aparece sola en el listado, en la ficha y en
// el filtro por sucursal, en el orden de branches (hallazgo 35); la
// inactiva no aparece, y los dos campos de antes siguen saliendo.
func TestUnaSucursalNuevaApareceSola(t *testing.T) {
	e := armar(t)
	e.sembrar(t)
	ctx := context.Background()
	ex := func(sql string) {
		t.Helper()
		if _, err := e.pool.Exec(ctx, sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	ex(`insert into branches (slug, name, sort_order) values ('casa-central', 'Casa Central', 1), ('aserradero', 'Aserradero', 2), ('puerto', 'Puerto', 0)`)
	ex(`insert into branches (slug, name, sort_order, active) values ('cerrada', 'Cerrada', 4, false)`)
	// El fenólico de 18 solo hay en Puerto (y en la cerrada, que no cuenta);
	// la melamina, en Casa Central.
	ex(`insert into inventory (variant_id, branch_id, qty, min_qty)
		select v.id, b.id, x.qty, 0 from product_variants v, branches b,
		  (values ('FEN18', 'puerto', 7), ('FEN18', 'cerrada', 50), ('MEL18', 'casa-central', 3)) x(sku, slug, qty)
		where v.sku = x.sku and b.slug = x.slug`)

	u := e.srv.URL + "/api/v1/catalogo/productos"
	_, b := pedir(t, &http.Client{}, u+"?busqueda=fenolico&publico=true")
	var ps []ProductoListado
	if err := json.Unmarshal([]byte(b), &ps); err != nil || len(ps) != 1 {
		t.Fatalf("listado: %s", b)
	}
	quiero := []StockDeSucursal{{"puerto", "Puerto", Alto}, {"casa-central", "Casa Central", SinStock}, {"aserradero", "Aserradero", SinStock}}
	if !mismoStock(ps[0].Stock, quiero) || !ps[0].HayStock || ps[0].StockCentral != SinStock || ps[0].StockAserradero != SinStock {
		t.Errorf("listado del fenólico: %s", b)
	}

	// El filtro por sucursal toma cualquier slug activo. Uno que no lo es (la
	// cerrada, un enlace viejo) vale como «en-stock» y no deja el catálogo
	// vacío (comité del 25/11).
	for filtro, slugs := range map[string][]string{"puerto": {"fenolico"}, "casa-central": {"melamina"}, "aserradero": {}, "cerrada": {"fenolico", "melamina"}, "no-existe": {"fenolico", "melamina"}, "en-stock": {"fenolico", "melamina"}} {
		_, b := pedir(t, &http.Client{}, u+"?publico=true&stock="+filtro)
		var ps []ProductoListado
		_ = json.Unmarshal([]byte(b), &ps)
		var vistos []string
		for _, p := range ps {
			vistos = append(vistos, p.Slug)
		}
		if len(vistos) != len(slugs) {
			t.Errorf("stock=%s: %v, quería %v", filtro, vistos, slugs)
			continue
		}
		for i := range slugs {
			if vistos[i] != slugs[i] {
				t.Errorf("stock=%s: %v, quería %v", filtro, vistos, slugs)
			}
		}
	}

	_, b = pedir(t, &http.Client{}, u+"/fenolico?publico=true")
	var f ProductoDetalle
	if err := json.Unmarshal([]byte(b), &f); err != nil || len(f.Variantes) != 2 {
		t.Fatalf("ficha: %s", b)
	}
	for _, v := range f.Variantes {
		quiero := []StockDeSucursal{{"puerto", "Puerto", SinStock}, {"casa-central", "Casa Central", SinStock}, {"aserradero", "Aserradero", SinStock}}
		disponibles := 0.0
		if v.Sku == "FEN18" {
			quiero[0].Nivel, disponibles = Alto, 7
		}
		// Las 50 de la cerrada no se pueden llevar.
		if !mismoStock(v.Stock, quiero) || v.Disponibles != disponibles {
			t.Errorf("ficha, %s: %+v (%v disponibles)", v.Sku, v.Stock, v.Disponibles)
		}
	}
}

func mismoStock(a, b []StockDeSucursal) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
