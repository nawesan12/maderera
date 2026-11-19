package pedidos

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Un presupuesto vencido no pasa a pedido con los precios viejos sin que
// nadie lo decida (T3, hallazgo 12): «actualizar» los pone al día y
// «respetar», pasado lo libre, pide el PIN de un admin. Uno rechazado no
// pasa.
func TestPresupuestoVencido(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	_, adm := e.staff(t, "duena@prueba.test", sqlc.StaffRoleAdmin)
	if err := e.ses.CargarPIN(t.Context(), adm, "una clave larga", "482915"); err != nil {
		t.Fatal(err)
	}
	general := e.id(t, `insert into price_lists (name, slug, is_default) values ('General', 'general', true) returning id`)
	e.exec(t, `insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 100000)`, general, e.placa)
	// Marzo: 2 placas a 84.500 más un flete; hoy la placa está a 100.000.
	presupuesto := func(estado string) string {
		q := e.id(t, `insert into quotes (numero, contacto_nombre, branch_id, estado, subtotal, total, valido_hasta)
			values ('PRE-'||floor(random()*1e6)::text, 'Juan', $1, $2, 181000, 181000, now() - interval '200 days') returning id`, e.sucursal, estado)
		e.exec(t, `insert into quote_items (quote_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, orden) values
			($1, $2, 'Fenólico 18 mm', 'placa', 2, 84500, 169000, 0), ($1, null, 'Flete', 'unidad', 1, 12000, 12000, 1)`, q, e.placa)
		return q
	}
	u := e.srv.URL + "/api/v1/admin/presupuestos/"

	q := presupuesto("enviado")
	// La ficha dice que venció y cuánto da con los precios de hoy.
	c, b := pedir(t, ven, "GET", u+q, nil)
	if c != 200 || !strings.Contains(b, `"vencido":true`) || !strings.Contains(b, `"totalDeHoy":"212000.00"`) {
		t.Fatalf("ficha: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", u+q+"/pedido", map[string]any{}); c != 422 || !strings.Contains(b, "elegí si se actualizan los precios") {
		t.Fatalf("vencido sin elegir: %d %s", c, b)
	}
	// Respetar, de un vendedor: 31.000 de 212.000 pasan el 5 %, pide el PIN.
	c, b = pedir(t, ven, "POST", u+q+"/pedido", map[string]any{"precios": "respetar"})
	if c != 422 || !strings.Contains(b, `"pinMonto":"31000.00"`) {
		t.Fatalf("respetar sin PIN: %d %s", c, b)
	}
	c, b = pedir(t, ven, "POST", u+q+"/pedido", map[string]any{"precios": "respetar", "pin": "482915"})
	if c != 200 {
		t.Fatalf("respetar con PIN: %d %s", c, b)
	}
	if s := e.texto(t, `select o.total::text || ' ' || o.dejado_de_cobrar::text || ' ' || u.email from orders o join "user" u on u.id = o.autorizado_por where o.quote_id = $1`, q); s != "181000.00 31000.00 duena@prueba.test" {
		t.Errorf("respetado: %s", s)
	}

	// Actualizar: los renglones con lista al precio de hoy, el flete igual.
	q = presupuesto("enviado")
	if c, b := pedir(t, ven, "POST", u+q+"/pedido", map[string]any{"precios": "actualizar"}); c != 200 {
		t.Fatalf("actualizar: %d %s", c, b)
	}
	if s := e.texto(t, `select o.subtotal::text || ' ' || o.total::text || ' ' || o.dejado_de_cobrar::text from orders o where o.quote_id = $1`, q); s != "212000.00 212000.00 0.00" {
		t.Errorf("actualizado: %s", s)
	}
	if s := e.texto(t, `select string_agg(precio_unitario::text || '/' || coalesce(precio_lista::text, '-'), ' ' order by orden) from order_items i join orders o on o.id = i.order_id where o.quote_id = $1`, q); s != "100000.00/100000.00 12000.00/-" {
		t.Errorf("renglones: %s", s)
	}

	// Rechazado: no.
	q = presupuesto("rechazado")
	if c, b := pedir(t, ven, "POST", u+q+"/pedido", map[string]any{"precios": "actualizar"}); c != 422 || !strings.Contains(b, "rechazado") {
		t.Fatalf("rechazado: %d %s", c, b)
	}
}

// Uno vigente también mide lo dejado de cobrar (revisión de T3): armar un
// presupuesto al 40 % abajo y pasarlo a pedido en el acto era el atajo para
// no llamar al admin. Contra la lista del día en que se emitió, si la tiene:
// el precio prometido no pide PIN porque la lista subió después. Y uno que
// emitió un admin con esos precios ya está firmado.
func TestPresupuestoVigenteBajoLaLista(t *testing.T) {
	e := armar(t)
	ven, vses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	_, adm := e.staff(t, "duena@prueba.test", sqlc.StaffRoleAdmin)
	if err := e.ses.CargarPIN(t.Context(), adm, "una clave larga", "482915"); err != nil {
		t.Fatal(err)
	}
	general := e.id(t, `insert into price_lists (name, slug, is_default) values ('General', 'general', true) returning id`)
	e.exec(t, `insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 100000)`, general, e.placa)
	presupuesto := func(precio float64, lista any, quien string) string {
		q := e.id(t, `insert into quotes (numero, contacto_nombre, branch_id, estado, subtotal, total, valido_hasta, created_by_user_id)
			values ('PRE-'||floor(random()*1e6)::text, 'Juan', $1, 'enviado', $2::numeric * 2, $2::numeric * 2, now() + interval '10 days', $3) returning id`,
			e.sucursal, precio, quien)
		e.exec(t, `insert into quote_items (quote_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, orden, precio_lista) values
			($1, $2, 'Fenólico 18 mm', 'placa', 2, $3::numeric, $3::numeric * 2, 0, $4::numeric)`, q, e.placa, precio, lista)
		return q
	}
	u := e.srv.URL + "/api/v1/admin/presupuestos/"

	// Al 40 % abajo, de un vendedor: pide el PIN por los 80.000.
	q := presupuesto(60000, 100000, vses.UserID)
	c, b := pedir(t, ven, "POST", u+q+"/pedido", map[string]any{})
	if c != 422 || !strings.Contains(b, `"pinMonto":"80000.00"`) {
		t.Fatalf("vigente bajo la lista sin PIN: %d %s", c, b)
	}
	if c, b = pedir(t, ven, "POST", u+q+"/pedido", map[string]any{"pin": "482915"}); c != 200 {
		t.Fatalf("con PIN: %d %s", c, b)
	}
	if s := e.texto(t, `select o.dejado_de_cobrar::text || ' ' || u.email from orders o join "user" u on u.id = o.autorizado_por where o.quote_id = $1`, q); s != "80000.00 duena@prueba.test" {
		t.Errorf("autorizado: %s", s)
	}
	// El precio prometido a la lista de entonces: la de hoy subió, no pide.
	q = presupuesto(84500, 84500, vses.UserID)
	if c, b := pedir(t, ven, "POST", u+q+"/pedido", map[string]any{}); c != 200 {
		t.Fatalf("a la lista del día que se emitió: %d %s", c, b)
	}
	// Sin la lista guardada (anterior a la 00142), contra la de hoy.
	q = presupuesto(60000, nil, vses.UserID)
	if c, _ := pedir(t, ven, "POST", u+q+"/pedido", map[string]any{}); c != 422 {
		t.Fatalf("sin lista guardada: %d", c)
	}
	// Lo emitió la dueña con esos precios: ya firmó ella.
	q = presupuesto(60000, 100000, adm.UserID)
	if c, b := pedir(t, ven, "POST", u+q+"/pedido", map[string]any{}); c != 200 {
		t.Fatalf("emitido por un admin: %d %s", c, b)
	}
	if s := e.texto(t, `select u.email from orders o join "user" u on u.id = o.autorizado_por where o.quote_id = $1`, q); s != "duena@prueba.test" {
		t.Errorf("firma del admin que lo emitió: %s", s)
	}
}
