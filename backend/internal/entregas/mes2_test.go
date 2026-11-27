package entregas

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/autorizacion"
	"mjbj/internal/reglas"
	"mjbj/internal/sqlc"
)

// Mes simulado 2 (M2S1-018, M2S1-019): el depósito soltaba un pedido sin
// cobrar con un toque. Ahora pide el PIN de un admin; quien vende, no (con
// la regla en «fuera_de_la_cuenta», sí, si no hay cuenta corriente). Uno
// cobrado sale sin preguntar.
func TestSoltarSinCobrarPideElPIN(t *testing.T) {
	e := armar(t)
	e.s.ConAutorizacion(autorizacion.Nuevo(e.pool, silencio, "secreto-del-pin-de-prueba"))
	dep, _ := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	_, _ = e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	u := e.srv.URL + "/api/v1/admin/remitos"
	cuerpo := func(pedido, renglon string) map[string]any {
		return map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "20111222", "cantidades": cantidades(renglon, "1")}
	}
	a, a1, _ := e.pedido(t, "PED-3001", "listo", nil)
	c, b := pedir(t, dep, "POST", u, cuerpo(a, a1))
	if c != 422 || !strings.Contains(b, `"pinMotivo":"sin_cobrar"`) || !strings.Contains(b, `"pinMonto":"100.00"`) {
		t.Fatalf("el depósito sin PIN: %d %s", c, b)
	}
	if n := e.uno(t, `select count(*)::text from deliveries where order_id = $1`, a); n != "0" {
		t.Fatalf("salió igual: %s", n)
	}
	// Con la contraseña del admin (no hay PIN cargado), sale.
	if c, b := pedir(t, dep, "POST", u, map[string]any{"orderId": a, "tipo": "retiro", "receptorDocumento": "20111222",
		"cantidades": cantidades(a1, "1"), "pin": "una clave larga"}); c != 200 {
		t.Fatalf("con la firma del admin: %d %s", c, b)
	}
	// Quien vende, sin PIN.
	v, v1, _ := e.pedido(t, "PED-3002", "listo", nil)
	if c, b := pedir(t, ven, "POST", u, cuerpo(v, v1)); c != 200 {
		t.Fatalf("el vendedor: %d %s", c, b)
	}
	// Con la regla, sin cuenta corriente, también pide.
	if err := reglas.Fijar(context.Background(), e.pool, reglas.EntregarSinCobrar, "fuera_de_la_cuenta"); err != nil {
		t.Fatal(err)
	}
	w, w1, _ := e.pedido(t, "PED-3003", "listo", nil)
	if c, b := pedir(t, ven, "POST", u, cuerpo(w, w1)); c != 422 || !strings.Contains(b, "sin_cobrar") {
		t.Fatalf("el vendedor con la regla: %d %s", c, b)
	}
	// Cobrado, no pregunta.
	e.exec(t, `update orders set estado_pago = 'pagado' where id = $1`, w)
	if c, b := pedir(t, dep, "POST", u, cuerpo(w, w1)); c != 200 {
		t.Fatalf("cobrado: %d %s", c, b)
	}
}

// M2S2-020, M3S1-006: con lo que hay en el galpón no alcanza, el remito no
// sale (se firmaba por 6 tirantes con 0 y el stock quedaba en negativo).
// Y M2S1-162: «1» no es un documento.
func TestElRemitoNoSacaMasDeLoQueHay(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, _ := e.pedido(t, "PED-3010", "listo", nil)
	u := e.srv.URL + "/api/v1/admin/remitos"
	if c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "1", "cantidades": cantidades(r1, "1")}); c != 422 ||
		!strings.Contains(b, MsjDocumentoInvalido) {
		t.Fatalf("documento 1: %d %s", c, b)
	}
	e.exec(t, `update inventory set qty = 3 where variant_id = $1`, e.variante)
	c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "20111222", "cantidades": cantidades(r1, "4")})
	if c != 422 || !strings.Contains(b, "No alcanza") || !strings.Contains(b, "hay 3") {
		t.Fatalf("sin stock: %d %s", c, b)
	}
	if q, _ := e.stock(t, e.variante); q != "3.000" && q != "3" {
		t.Fatalf("el stock se movió: %s", q)
	}
	if c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "20.111.222", "cantidades": cantidades(r1, "3")}); c != 200 {
		t.Fatalf("lo que hay: %d %s", c, b)
	}
}

// M2S1-022, M2S1-075, M2S2-019, M2S2-057, M3S3-036: el corte va en el
// remito que se llevó sus piezas, y en ninguno más; el corte en cola no se
// firma como cortado, y un remito ya firmado no toma un corte posterior.
func TestElCorteVaEnUnSoloRemito(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, _ := e.pedido(t, "PED-3020", "listo", nil)
	e.exec(t, `update orders set estado_pago = 'pagado' where id = $1`, pedido)
	corte := e.uno(t, `insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado, variant_id, placas)
		values ('CRT-3', $1, 'Wood Frame', 'Tirante', 'en-cola', $2, 3) returning id::text`, pedido, e.variante)
	e.exec(t, `insert into cutting_items (cutting_order_id, largo_mm, ancho_mm, cantidad) values ($1, 500, 300, 10)`, corte)
	u := e.srv.URL + "/api/v1/admin/remitos"
	retirar := func(n string) string {
		t.Helper()
		if c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "20111222", "cantidades": cantidades(r1, n)}); c != 200 {
			t.Fatalf("retirar %s: %d %s", n, c, b)
		}
		return e.uno(t, `select id::text from deliveries where order_id = $1 order by created_at desc limit 1`, pedido)
	}
	corteDe := func(remito string) string {
		t.Helper()
		r, err := e.s.RemitoCompleto(context.Background(), remito)
		if err != nil {
			t.Fatal(err)
		}
		if r.Lineas[0].Corte == nil {
			return ""
		}
		return *r.Lineas[0].Corte
	}
	primero := retirar("3")
	if c := corteDe(primero); c != "" {
		t.Fatalf("con el corte en cola: %q", c)
	}
	e.exec(t, `update cutting_orders set estado = 'terminado', terminado_at = now() where id = $1`, corte)
	if c := corteDe(primero); c != "" {
		t.Fatalf("el remito de antes cambió: %q", c)
	}
	segundo := retirar("4")
	if c := corteDe(segundo); c != "Cortado según CRT-3: 10 piezas de 3 placas · 1 entera" {
		t.Fatalf("el que se llevó las piezas: %q", c)
	}
	tercero := retirar("3")
	if c := corteDe(tercero); c != "" {
		t.Fatalf("el de después repite el corte: %q", c)
	}
}

// M2S2-067, M2S2-125: de un corte de medias placas se dice «medias placas»,
// sin pasar lo que lleva el renglón.
func TestElCorteDeMediaPlaca(t *testing.T) {
	if got := *TextoDelCorte([]corteDelRenglon{{numero: "CRT-2", placas: 3, piezas: 6, mitad: true}}, 2); got != "Cortado según CRT-2: 6 piezas de 2 medias placas" {
		t.Errorf("%q", got)
	}
	if got := *TextoDelCorte([]corteDelRenglon{{numero: "CRT-55", placas: 1, piezas: 4, mitad: true}}, 1); got != "Cortado según CRT-55: 4 piezas de 1 media placa" {
		t.Errorf("%q", got)
	}
	if got := *TextoDelCorte([]corteDelRenglon{{numero: "CRT-13", placas: 2, piezas: 14}}, 3); got != "Cortado según CRT-13: 14 piezas de 2 placas · 1 entera" {
		t.Errorf("%q", got)
	}
}

// M2S3-006, M2S3-100: lo de otro pedido del cliente se ofrece si está listo
// y cobrado; uno sin preparar y sin cobrar, no.
func TestOtroAcopioSinCobrarNoSeOfrece(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	_, cliente := e.web(t, "martina@prueba.test")
	a, a1, _ := e.pedido(t, "PED-1059", "listo", &cliente)
	b, b1, _ := e.pedido(t, "PED-1100", "pendiente", &cliente)
	e.exec(t, `update orders set estado_pago = 'pagado' where id = $1`, a)
	otros, err := e.s.OtrosAcopios(context.Background(), a)
	if err != nil || len(otros) != 0 {
		t.Fatalf("se ofrece el sin cobrar: %+v %v", otros, err)
	}
	c, body := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/remitos", map[string]any{"orderId": a, "tipo": "retiro", "receptorDocumento": "20111222",
		"cantidades": cantidades(a1, "1"), "otros": []any{map[string]any{"orderId": b, "cantidades": cantidades(b1, "1")}}})
	if c != 422 || !strings.Contains(body, "listo y cobrado") {
		t.Fatalf("lo sumó igual: %d %s", c, body)
	}
}

// M2S4-020, M2S1-158, M2S1-160: el remito R lleva el CUIT y la condición
// de IVA del cliente, el domicilio de su ficha en un retiro, y el que
// completa un pedido que salió en partes es el «final».
func TestElRemitoLlevaLosDatosDelCliente(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	cliente := e.uno(t, `insert into customers (nombre, razon_social, cuit, condicion_iva) values ('Sim Constructora', 'Sim Constructora del Sur SRL', '30715550101', 'responsable_inscripto') returning id::text`)
	e.exec(t, `insert into addresses (customer_id, etiqueta, calle) values ($1, 'Sim Casa', 'Av. Sim Colón 1234')`, cliente)
	pedido, r1, r2 := e.pedido(t, "PED-1159", "listo", &cliente)
	e.exec(t, `update orders set estado_pago = 'pagado' where id = $1`, pedido)
	u := e.srv.URL + "/api/v1/admin/remitos"
	for _, c := range [][]map[string]string{cantidades(r1, "10"), cantidades(r2, "4")} {
		if st, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "27365550", "cantidades": c}); st != 200 {
			t.Fatalf("%d %s", st, b)
		}
	}
	ultimo := e.uno(t, `select id::text from deliveries where order_id = $1 order by created_at desc limit 1`, pedido)
	r, err := e.s.RemitoCompleto(context.Background(), ultimo)
	if err != nil {
		t.Fatal(err)
	}
	if r.ClienteCuit == nil || *r.ClienteCuit != "30715550101" || r.ClienteCondicionIva == nil || *r.ClienteCondicionIva != "responsable_inscripto" ||
		r.ClienteRazonSocial == nil || *r.ClienteRazonSocial != "Sim Constructora del Sur SRL" {
		t.Errorf("datos fiscales: %v %v %v", r.ClienteCuit, r.ClienteCondicionIva, r.ClienteRazonSocial)
	}
	if r.ClienteDireccion == nil || !strings.Contains(*r.ClienteDireccion, "Sim Colón 1234") {
		t.Errorf("domicilio: %v", r.ClienteDireccion)
	}
	if !r.Final || r.Notas != nil {
		t.Errorf("final %v, notas %v", r.Final, r.Notas)
	}
}

// M2S3-087, M2S4-046: anular sin firmar deja el motivo en el historial, sin
// hablar de acopio.
func TestAnularSinFirmarDejaElMotivo(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, r2 := e.pedido(t, "PED-1059", "listo", nil)
	e.exec(t, `update orders set estado_pago = 'pagado' where id = $1`, pedido)
	if c, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/remitos", map[string]any{"orderId": pedido, "tipo": "retiro",
		"receptorDocumento": "27365550", "cantidades": cantidades(r1, "10", r2, "4")}); c != 200 {
		t.Fatalf("%d %s", c, b)
	}
	remito := e.uno(t, `select id::text from deliveries where order_id = $1`, pedido)
	if c, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/remitos/"+remito+"/anular", map[string]any{"motivo": "Otra persona"}); c != 200 {
		t.Fatalf("anular: %d %s", c, b)
	}
	if estado, nota := e.estadoYNota(t, pedido); estado != "listo" || nota != "Remito REM-0001 anulado: Otra persona" {
		t.Fatalf("historial: %q %q", estado, nota)
	}
}
