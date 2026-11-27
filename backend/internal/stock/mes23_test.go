package stock

import (
	"encoding/json"
	"strings"
	"testing"
)

// Lo que encontró el mes simulado en producción (tanda 23), área stock.

// M2S4-021 y M3S3-016: el traslado se recibe contando. Llegan 10 de 12
// tornillos y una placa que no figuraba; lo que falta vuelve al origen y la
// placa sale del origen al recibir. El comprobante dice lo que llegó.
func TestTrasladoSeRecibeContando(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	u := e.srv.URL + "/api/v1/admin/stock/traslados"
	e.exec(t, `insert into inventory (variant_id, branch_id, qty) values ($1, $2, 20)`, e.tornillo, e.central)
	c, b := pedir(t, dep, "POST", u, map[string]any{"origenId": e.central, "destinoId": e.aserradero,
		"renglones": []map[string]string{{"variantId": e.tornillo, "cantidad": "12"}}})
	if c != 201 {
		t.Fatalf("traslado: %d %s", c, b)
	}
	var tr TrasladoCreado
	_ = json.Unmarshal([]byte(b), &tr)
	// Una medida mal escrita no recibe nada.
	if c, b := pedir(t, dep, "POST", u+"/"+tr.ID+"/recibir", map[string]any{"renglones": []map[string]string{{"variantId": e.tornillo, "cantidad": "diez"}}}); c != 422 {
		t.Fatalf("cantidad mal: %d %s", c, b)
	}
	// Otra medida de la que no hay para mover en el origen: no se recibe.
	if c, b := pedir(t, dep, "POST", u+"/"+tr.ID+"/recibir", map[string]any{"renglones": []map[string]string{
		{"variantId": e.tornillo, "cantidad": "10"}, {"variantId": e.placa, "cantidad": "4"}}}); c != 422 || !strings.Contains(b, "hay 3 para mover") {
		t.Fatalf("placa que no hay: %d %s", c, b)
	}
	if c, b := pedir(t, dep, "POST", u+"/"+tr.ID+"/recibir", map[string]any{"faltante": "origen", "renglones": []map[string]string{
		{"variantId": e.tornillo, "cantidad": "10"}, {"variantId": e.placa, "cantidad": "1"}}}); c != 204 {
		t.Fatalf("recibir: %d %s", c, b)
	}
	if e.qty(t, e.tornillo, e.central) != 10 || e.qty(t, e.tornillo, e.aserradero) != 10 ||
		e.qty(t, e.placa, e.central) != 9 || e.qty(t, e.placa, e.aserradero) != 3 {
		t.Fatalf("stock: tornillo %v/%v placa %v/%v", e.qty(t, e.tornillo, e.central), e.qty(t, e.tornillo, e.aserradero),
			e.qty(t, e.placa, e.central), e.qty(t, e.placa, e.aserradero))
	}
	_, b = pedir(t, dep, "GET", u+"/"+tr.ID, nil)
	var visto Traslado
	_ = json.Unmarshal([]byte(b), &visto)
	if visto.Estado != "recibido" || visto.Faltante == nil || *visto.Faltante != "origen" || len(visto.Renglones) != 2 ||
		*visto.Renglones[0].Recibido != 10 || visto.Renglones[0].Cantidad != 12 || visto.Renglones[1].Cantidad != 0 || *visto.Renglones[1].Recibido != 1 {
		t.Fatalf("comprobante: %s", b)
	}
	// Los movimientos cierran con el stock.
	for _, x := range []struct{ v, s string }{{e.tornillo, e.central}, {e.placa, e.central}, {e.tornillo, e.aserradero}} {
		var suma float64
		_ = e.pool.QueryRow(t.Context(), `select coalesce(sum(qty), 0)::float8 from inventory_movements where transfer_group = $1 and variant_id = $2 and branch_id = $3`,
			tr.ID, x.v, x.s).Scan(&suma)
		want := map[string]float64{e.tornillo + e.central: -10, e.placa + e.central: -1, e.tornillo + e.aserradero: 10}[x.v+x.s]
		if suma != want {
			t.Errorf("movimientos %s %s: %v, quería %v", x.v, x.s, suma, want)
		}
	}

	// Lo que se perdió en el viaje: vuelve y sale como faltante, con su costo.
	e.exec(t, `insert into variant_costs (variant_id, cantidad_base, costo_promedio) values ($1, 10, 150)`, e.tornillo)
	_, b = pedir(t, dep, "POST", u, map[string]any{"origenId": e.central, "destinoId": e.aserradero,
		"renglones": []map[string]string{{"variantId": e.tornillo, "cantidad": "4"}}})
	_ = json.Unmarshal([]byte(b), &tr)
	if c, b := pedir(t, dep, "POST", u+"/"+tr.ID+"/recibir", map[string]any{"faltante": "perdido", "renglones": []map[string]string{
		{"variantId": e.tornillo, "cantidad": "3"}}}); c != 204 {
		t.Fatalf("recibir con pérdida: %d %s", c, b)
	}
	if e.qty(t, e.tornillo, e.central) != 6 || e.qty(t, e.tornillo, e.aserradero) != 13 {
		t.Fatalf("con pérdida: %v %v", e.qty(t, e.tornillo, e.central), e.qty(t, e.tornillo, e.aserradero))
	}
	if costo := e.uno(t, `select costo_unitario::text from inventory_movements where type = 'egreso' and transfer_group = $1`, tr.ID); costo != "150.0000" {
		t.Errorf("costo del faltante: %s", costo)
	}
	faltante := false
	for _, m := range movimientos(t, e, dep, "?busqueda=TOR") {
		if m.Concepto == "Faltante" && m.Referencia != nil && *m.Referencia == "TRA-0002" && m.Qty == -1 {
			faltante = true
		}
	}
	if !faltante {
		t.Errorf("el libro no dice el faltante del traslado")
	}
}

// M3S3-016 y M3S3-022: un traslado mal cargado se anula mientras va en
// camino, y todo vuelve al origen.
func TestTrasladoSeAnulaEnCamino(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	u := e.srv.URL + "/api/v1/admin/stock/traslados"
	_, b := pedir(t, dep, "POST", u, map[string]any{"origenId": e.central, "destinoId": e.aserradero,
		"renglones": []map[string]string{{"variantId": e.placa, "cantidad": "2,5"}}})
	var tr TrasladoCreado
	_ = json.Unmarshal([]byte(b), &tr)
	if e.qty(t, e.placa, e.central) != 7.5 {
		t.Fatalf("salió: %v", e.qty(t, e.placa, e.central))
	}
	if c, b := pedir(t, dep, "POST", u+"/"+tr.ID+"/anular", nil); c != 204 {
		t.Fatalf("anular: %d %s", c, b)
	}
	if e.qty(t, e.placa, e.central) != 10 || e.qty(t, e.placa, e.aserradero) != 2 {
		t.Fatalf("volvió: %v %v", e.qty(t, e.placa, e.central), e.qty(t, e.placa, e.aserradero))
	}
	if c, b := pedir(t, dep, "POST", u+"/"+tr.ID+"/recibir", nil); c != 422 || !strings.Contains(b, "TRA-0001 está anulado.") {
		t.Errorf("recibir anulado: %d %s", c, b)
	}
	if c, b := pedir(t, dep, "POST", u+"/"+tr.ID+"/anular", nil); c != 422 || !strings.Contains(b, "ya está anulado") {
		t.Errorf("anular dos veces: %d %s", c, b)
	}
	if g := grilla(t, e, dep, "?busqueda=FEN18"); g.Filas[0].Sucursales[1].Llegando != 0 {
		t.Errorf("ya no llega: %+v", g.Filas[0].Sucursales[1])
	}
	if _, b := pedir(t, dep, "GET", u, nil); strings.Contains(b, tr.ID) {
		t.Errorf("sigue en camino: %s", b)
	}
	// Uno recibido no se anula.
	_, b = pedir(t, dep, "POST", u, map[string]any{"origenId": e.central, "destinoId": e.aserradero,
		"renglones": []map[string]string{{"variantId": e.placa, "cantidad": "1"}}})
	_ = json.Unmarshal([]byte(b), &tr)
	pedir(t, dep, "POST", u+"/"+tr.ID+"/recibir", nil)
	if c, _ := pedir(t, dep, "POST", u+"/"+tr.ID+"/anular", nil); c != 422 {
		t.Errorf("anular recibido: %d", c)
	}
}

// M2S1-169: el movimiento dice quién lo hizo y el antes y el después.
func TestMovimientoDiceQuienYCuanto(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	if c, b := pedir(t, dep, "POST", e.srv.URL+"/api/v1/admin/stock/ajuste",
		map[string]any{"variantId": e.placa, "branchSlug": "casa-central", "cantidad": 0, "contado": 9}); c != 200 {
		t.Fatalf("conteo: %d %s", c, b)
	}
	m := movimientos(t, e, dep, "?busqueda=FEN18")
	if m[0].Concepto != "Conteo" || m[0].Usuario == nil || *m[0].Usuario != "Persona" || m[0].Antes == nil || *m[0].Antes != 10 || *m[0].Despues != 9 {
		t.Fatalf("movimiento: %+v", m[0])
	}
	if a, d := AntesYDespues("Ingreso desde Stock (1.234,5 → 1.240)"); a == nil || *a != 1234.5 || *d != 1240 {
		t.Errorf("miles: %v %v", a, d)
	}
	// M3S3-013: el ajuste congela el costo promedio de ese momento.
	e.exec(t, `insert into variant_costs (variant_id, cantidad_base, costo_promedio) values ($1, 10, 6619.3)`, e.placa)
	if c, b := pedir(t, dep, "POST", e.srv.URL+"/api/v1/admin/stock/ajuste",
		map[string]any{"variantId": e.placa, "branchSlug": "aserradero", "cantidad": -1, "motivo": "rotura"}); c != 200 {
		t.Fatalf("rotura: %d %s", c, b)
	}
	e.exec(t, `update variant_costs set costo_promedio = 1 where variant_id = $1`, e.placa)
	if costo := e.uno(t, `select costo_unitario::text from inventory_movements where note like 'Rotura%'`); costo != "6619.3000" {
		t.Errorf("costo congelado: %s", costo)
	}
}

// M2S2-122: el total no resta un negativo; el faltante va aparte.
// M2S1-028: los grupos se pueden mirar por sucursal.
func TestTotalSinRestarElFaltanteYGruposPorSucursal(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	// Casa Central: 10 físicas y 24 reservadas (−14); Aserradero: 200.
	e.exec(t, `update inventory set reservado = 24, min_qty = 0 where variant_id = $1 and branch_id = $2`, e.placa, e.central)
	e.exec(t, `update inventory set qty = 200, min_qty = 0 where variant_id = $1 and branch_id = $2`, e.placa, e.aserradero)
	f := grilla(t, e, dep, "?busqueda=FEN18").Filas[0]
	if f.Total != 200 || f.Faltante != 14 {
		t.Fatalf("total %v faltante %v", f.Total, f.Faltante)
	}
	// El tornillo: 50 en Casa Central (bien) y nada en el Aserradero, mínimo 20.
	e.exec(t, `insert into inventory (variant_id, branch_id, qty, min_qty) values ($1, $2, 50, 0), ($1, $3, 0, 20)`, e.tornillo, e.central, e.aserradero)
	if g := grilla(t, e, dep, ""); g.Conteos.Reponer != 2 {
		t.Fatalf("todas: %+v", g.Conteos)
	}
	// En Casa Central, el tornillo está bien y la placa (en negativo) pide.
	g := grilla(t, e, dep, "?sucursal=casa-central")
	if g.Conteos.Reponer != 1 || g.Conteos.ConStock != 1 || g.Conteos.SinStock != 0 {
		t.Fatalf("casa central: %+v", g.Conteos)
	}
	if r := grilla(t, e, dep, "?sucursal=casa-central&estado=con-stock"); r.Total != 1 || r.Filas[0].SKU != "TOR" || r.Filas[0].ParaReponer {
		t.Fatalf("con stock en casa central: %+v", r.Filas)
	}
	// En el Aserradero, al revés: el tornillo pide y la placa está bien.
	if r := grilla(t, e, dep, "?sucursal=aserradero&estado=reponer"); r.Total != 1 || r.Filas[0].SKU != "TOR" || !r.Filas[0].ParaReponer {
		t.Fatalf("reponer en el aserradero: %+v", r.Filas)
	}
}

// M3S3-049: «MDF 18» pone primero el de 18 mm y no el de 3 mm, que también
// tiene un «18» al principio de «1830».
func TestBuscarMDF18TraeElDe18(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	cat := e.uno(t, `select id from categories limit 1`)
	mdf := e.uno(t, `insert into products (slug, name, category_id, description, unit) values ('mdf', 'MDF', $1, '', 'placa') returning id`, cat)
	e.exec(t, `insert into product_variants (product_id, sku, label, sort_order) values
		($1, 'PLA-MDF-003', '1830 x 2600mm — 3mm', 0), ($1, 'PLA-MDF-018', '1830 x 2600mm — 18mm', 1)`, mdf)
	g := grilla(t, e, dep, "?busqueda=MDF+18")
	if len(g.Filas) != 2 || g.Filas[0].SKU != "PLA-MDF-018" {
		t.Fatalf("orden: %+v", g.Filas)
	}
}
