package cortes

import (
	"context"
	"strings"
	"testing"
	"time"

	"mjbj/internal/entregas"
	"mjbj/internal/pdf"
	"mjbj/internal/reglas"
)

// H045: el corte suelto. Con la regla de arranque («primera») sin sucursal
// va a la primera; con «preguntar» y más de una sucursal, Go lo rechaza
// hasta que se elija. El corte de un pedido no pregunta: usa la del pedido.
func TestDondeSeCortaElCorteSuelto(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	aserradero := e.txt(t, `insert into branches (slug, name, sort_order) values ('aserradero', 'Aserradero', 2) returning id::text`)

	id := alta(t, e, ven, melamina(e))
	if s := e.txt(t, `select branch_id::text from cutting_orders where id = $1`, id); s != e.central {
		t.Errorf("de arranque, la primera: %s", s)
	}
	if err := reglas.Fijar(ctx, e.pool, reglas.SucursalDelCorteSuelto, "preguntar"); err != nil {
		t.Fatal(err)
	}
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", melamina(e)); code != 422 || !strings.Contains(b, "Elegí dónde se corta.") {
		t.Errorf("sin elegir: %d %s", code, b)
	}
	id = alta(t, e, ven, melamina(e, "branchId", aserradero))
	if s := e.txt(t, `select branch_id::text from cutting_orders where id = $1`, id); s != aserradero {
		t.Errorf("la elegida: %s", s)
	}
	pedido := e.pedido(t, "PED-1070", map[string]any{"variante": e.melamina, "descripcion": "Melamina Blanca", "unidad": "placa", "cantidad": 1, "precio": 84500})
	alta(t, e, ven, melamina(e, "orderId", pedido))
	// Con una sola sucursal activa no hay nada que preguntar.
	if _, err := e.pool.Exec(ctx, `update branches set active = false where id = $1`, aserradero); err != nil {
		t.Fatal(err)
	}
	alta(t, e, ven, melamina(e))
}

// H184: lo que el corte de un pedido cobra aparte (el tapacanto, las
// pasadas) se suma al pedido con «Sumar al pedido». Al pedido abierto, como
// renglones del corte; el otro corte del mismo pedido sigue con lo suyo
// aparte; dos veces no se suma. Facturado, cobrado o en la cuenta corriente,
// va a un pedido aparte que se cobra solo, y el corte no se entrega hasta
// cobrarlo. Cancelado, nada.
func TestSumarLasPasadasAlPedido(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	sumar := func(id string) (int, string) {
		return pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes/"+id+"/sumar-al-pedido", nil)
	}
	placa := map[string]any{"variante": e.melamina, "descripcion": "Melamina Blanca", "unidad": "placa", "cantidad": 3, "precio": 84500}

	// Al pedido abierto.
	pedido := e.pedido(t, "PED-1059", placa)
	id := alta(t, e, ven, melamina(e, "orderId", pedido))
	otro := alta(t, e, ven, melamina(e, "orderId", pedido, "piezas", []any{pieza(600, 300, 2, "cantoLargo", 1)}))
	f := leerFicha(t, e, ven, id)
	s, _ := f["sumar"].(map[string]any)
	if s == nil || s["aparte"] != false {
		t.Fatalf("la ficha no ofrece sumar: %v", f["sumar"])
	}
	afuera := s["total"].(float64)
	if afuera <= 0 || afuera != f["cuenta"].(map[string]any)["total"].(float64) {
		t.Fatalf("lo de afuera: %v", s)
	}
	if code, b := sumar(id); code != 200 || !strings.Contains(b, `"numero":"PED-1059"`) || !strings.Contains(b, `"aparte":false`) {
		t.Fatalf("sumar: %d %s", code, b)
	}
	if v := e.txt(t, `select total::text from orders where id = $1`, pedido); v != fmtMonto(3*84500+afuera) {
		t.Errorf("el total del pedido: %s", v)
	}
	if n := e.txt(t, `select count(*)::text from order_items where order_id = $1 and del_corte and cutting_order_id = $2`, pedido, id); n == "0" {
		t.Error("los renglones no dicen su corte")
	}
	if f := leerFicha(t, e, ven, id); f["modo"] != "vendido" || f["sumar"] != nil || f["pedido"].(map[string]any)["cobrado"].(float64) != afuera {
		t.Errorf("la ficha después: %v %v %v", f["modo"], f["sumar"], f["pedido"])
	}
	// Las placas las sigue vendiendo el pedido: los retales son del cliente
	// y el plano no vuelve a cobrar pasadas.
	if f := leerFicha(t, e, ven, id); f["retalesDelCliente"] != true || f["pasadasACobrar"].(float64) != 0 {
		t.Errorf("después de sumar, las placas: %v %v", f["retalesDelCliente"], f["pasadasACobrar"])
	}
	if f := leerFicha(t, e, ven, otro); f["modo"] != "pedido" || f["sumar"] == nil {
		t.Errorf("el otro corte del pedido quedó cobrado: %v %v", f["modo"], f["sumar"])
	}
	if code, b := sumar(id); code != 422 || !strings.Contains(b, "ya está en el pedido") {
		t.Errorf("dos veces: %d %s", code, b)
	}
	if n := e.txt(t, `select count(*)::text from order_status_history where order_id = $1 and nota like 'Se sumó lo del corte CRT-1:%'`, pedido); n != "1" {
		t.Errorf("historial: %s", n)
	}

	// Cobrado, facturado o en la cuenta corriente: aparte.
	casos := []struct {
		numero, motivo, preparar string
	}{
		{"PED-3060", "PED-3060 ya está cobrado.", `update orders set estado_pago = 'pagado' where id = $1`},
		{"PED-2061", "PED-2061 ya está facturado.", `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
			values ('factura_b', 3, 61, 'X', 413.22, 86.78, 0, 0, 0, 500, 'autorizada', now(), '7612', $1)`},
		{"PED-2062", "PED-2062 está en la cuenta corriente.", `update orders set medio_pago = 'cuenta_corriente' where id = $1`},
	}
	for _, k := range casos {
		p := e.pedido(t, k.numero, placa)
		if _, err := e.pool.Exec(ctx, k.preparar, p); err != nil {
			t.Fatal(err)
		}
		antes := e.txt(t, `select total::text from orders where id = $1`, p)
		corte := alta(t, e, ven, melamina(e, "orderId", p))
		s, _ := leerFicha(t, e, ven, corte)["sumar"].(map[string]any)
		if s == nil || s["aparte"] != true || s["motivo"] != k.motivo {
			t.Errorf("%s: la ficha dice %v", k.numero, s)
			continue
		}
		code, b := sumar(corte)
		if code != 200 || !strings.Contains(b, `"aparte":true`) {
			t.Errorf("%s: %d %s", k.numero, code, b)
			continue
		}
		if v := e.txt(t, `select total::text from orders where id = $1`, p); v != antes {
			t.Errorf("%s: se tocó el pedido (%s → %s)", k.numero, antes, v)
		}
		cargo := e.txt(t, `select o.numero || ' ' || o.total::text || ' ' || o.estado_pago::text || ' ' || o.customer_id::text
			from cutting_orders co join orders o on o.id = co.cargo_order_id where co.id = $1`, corte)
		if cargo != strings.Join([]string{e.txt(t, `select numero from orders where id = (select cargo_order_id from cutting_orders where id = $1)`, corte),
			fmtMonto(s["total"].(float64)), "pendiente", e.cliente}, " ") {
			t.Errorf("%s: el pedido aparte: %s", k.numero, cargo)
		}
		f := leerFicha(t, e, ven, corte)
		if f["modo"] != "vendido" || f["pedido"].(map[string]any)["cargo"] == nil || f["retalesDelCliente"] != true {
			t.Errorf("%s: la ficha después: %v %v", k.numero, f["modo"], f["pedido"])
		}
	}
	// El corte del pedido cobrado no se entrega hasta cobrar el aparte.
	cobrado := e.txt(t, `select id::text from cutting_orders where order_id = (select id from orders where numero = 'PED-3060')`)
	u := e.srv.URL + "/api/v1/admin/cortes/" + cobrado
	for _, paso := range []string{"en-cola", "en-proceso"} {
		pedir(t, ven, "POST", u+"/avanzar?desde="+paso, nil)
	}
	if code, b := pedir(t, ven, "POST", u+"/avanzar?desde=terminado", nil); code != 409 || !strings.Contains(b, "no está cobrado") {
		t.Errorf("retirar sin cobrar el aparte: %d %s", code, b)
	}
	if _, err := e.pool.Exec(ctx, `update orders set estado_pago = 'pagado' where id = (select cargo_order_id from cutting_orders where id = $1)`, cobrado); err != nil {
		t.Fatal(err)
	}
	if code, b := pedir(t, ven, "POST", u+"/avanzar?desde=terminado", nil); code != 200 {
		t.Errorf("retirar con el aparte cobrado: %d %s", code, b)
	}

	// Cancelado: no se ofrece ni se suma.
	p := e.pedido(t, "PED-1063", placa)
	corte := alta(t, e, ven, melamina(e, "orderId", p))
	if _, err := e.pool.Exec(ctx, `update orders set estado = 'cancelado' where id = $1`, p); err != nil {
		t.Fatal(err)
	}
	if f := leerFicha(t, e, ven, corte); f["sumar"] != nil {
		t.Errorf("ofrece sumar a un cancelado: %v", f["sumar"])
	}
	if code, b := sumar(corte); code != 422 || !strings.Contains(b, "está cancelado") {
		t.Errorf("cancelado: %d %s", code, b)
	}
	// El aserradero no suma.
	ase := e.staff(t, "aserradero@prueba.test", "aserradero")
	if code, _ := pedir(t, ase, "POST", e.srv.URL+"/api/v1/admin/cortes/"+otro+"/sumar-al-pedido", nil); code != 403 {
		t.Errorf("el aserradero sumó: %d", code)
	}
}

// H321: la reposición sin cargo sale con su remito, atado al pedido que la
// originó: dice sus piezas y «Sin cargo», no toca el acopio del pedido, se
// firma con el dedo y la firma cierra el reclamo. Anulado, la ficha lo
// rehace.
func TestRemitoDeLaReposicion(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	pedido := e.pedido(t, "PED-1068", map[string]any{"variante": e.melamina, "descripcion": "Melamina Blanca", "unidad": "placa", "cantidad": 3, "precio": 84500})
	id := alta(t, e, ven, melamina(e, "orderId", pedido, "sinCargo", true, "piezas", []any{pieza(450, 400, 2)}))
	u := e.srv.URL + "/api/v1/admin/cortes/" + id
	if code, b := pedir(t, ven, "POST", u+"/remito", nil); code != 422 || !strings.Contains(b, "todavía no se entregó") {
		t.Errorf("remito antes de entregar: %d %s", code, b)
	}
	for _, paso := range []string{"en-cola", "en-proceso", "terminado"} {
		if code, b := pedir(t, ven, "POST", u+"/avanzar?desde="+paso, nil); code != 200 {
			t.Fatalf("%s: %d %s", paso, code, b)
		}
	}
	f := leerFicha(t, e, ven, id)
	rem, _ := f["remito"].(map[string]any)
	if rem == nil || rem["numero"] != "REM-0001" || rem["firmado"] != false || rem["firmaToken"] == nil {
		t.Fatalf("la ficha sin remito: %v", f["remito"])
	}
	// Pedirlo otra vez devuelve el mismo.
	if code, b := pedir(t, ven, "POST", u+"/remito", nil); code != 200 || !strings.Contains(b, `"numero":"REM-0001"`) {
		t.Errorf("otra vez: %d %s", code, b)
	}
	ent := entregas.Nuevo(e.pool, silencio)
	r, err := ent.RemitoCompleto(ctx, rem["id"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if r.Reposicion == nil || *r.Reposicion != "CRT-1" || len(r.Lineas) != 1 || r.Lineas[0].Descripcion != "Melamina Blanca — 450 × 400 mm" ||
		r.Lineas[0].Cantidad != 2 || r.Lineas[0].Unidad != "pieza" || len(r.Pendientes) != 0 || r.SinCobrar != nil || r.PedidoNumero != "PED-1068" {
		t.Errorf("el remito: %+v", r)
	}
	if c := pdf.CondicionDePago(r.ParaElPdf()); c != "Sin cargo" {
		t.Errorf("condición: %s", c)
	}
	if _, err := pdf.Remito(pdf.DatosRemito{Remito: r.ParaElPdf()}, time.Now()); err != nil {
		t.Errorf("pdf: %v", err)
	}
	// El acopio del pedido no cambia: las 3 placas siguen por retirar.
	saldo, err := entregas.SaldoDeAcopio(ctx, e.pool, pedido)
	if err != nil || len(saldo) != 1 || saldo[0].Pendiente != 3 {
		t.Errorf("acopio: %+v %v", saldo, err)
	}
	listado, _ := ent.RemitosDelPedido(ctx, pedido)
	if len(listado) != 1 || listado[0].Reposicion == nil || listado[0].Parcial || listado[0].CantidadLineas != 1 {
		t.Errorf("en la ficha del pedido: %+v", listado)
	}
	// La firma cierra el reclamo.
	if _, err := ent.RegistrarFirma(ctx, entregas.FormFirma{Token: rem["firmaToken"].(string), ReceptorNombre: "Gómez", Firma: "subidas/firma.png"}, nil); err != nil {
		t.Fatal(err)
	}
	if n := e.txt(t, `select count(*)::text from order_status_history where order_id = $1 and nota = 'Reposición sin cargo CRT-1 firmada por Gómez en el remito REM-0001: reclamo cerrado'`, pedido); n != "1" {
		t.Errorf("reclamo cerrado: %s", n)
	}
	if f := leerFicha(t, e, ven, id); f["remito"].(map[string]any)["firmado"] != true {
		t.Errorf("la ficha no lo ve firmado: %v", f["remito"])
	}
	// Anulado, se rehace con otro número.
	if _, err := e.pool.Exec(ctx, `update deliveries set estado = 'anulada' where cutting_order_id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if f := leerFicha(t, e, ven, id); f["remito"] != nil {
		t.Errorf("muestra el anulado: %v", f["remito"])
	}
	if code, b := pedir(t, ven, "POST", u+"/remito", nil); code != 200 || !strings.Contains(b, `"numero":"REM-0002"`) {
		t.Errorf("rehacer: %d %s", code, b)
	}
	// Un corte que no es reposición no tiene remito propio.
	otro := alta(t, e, ven, melamina(e, "orderId", pedido))
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes/"+otro+"/remito", nil); code != 422 || !strings.Contains(b, "no es una reposición") {
		t.Errorf("corte común: %d %s", code, b)
	}
	ase := e.staff(t, "aserradero@prueba.test", "aserradero")
	if code, _ := pedir(t, ase, "POST", u+"/remito", nil); code != 403 {
		t.Errorf("el aserradero hizo el remito: %d", code)
	}
}
