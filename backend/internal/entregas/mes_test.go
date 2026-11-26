package entregas

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/autorizacion"
	"mjbj/internal/sqlc"
)

// Lo que encontró el mes simulado en producción (26/11/2026) en los
// remitos: el envío en dos viajes, el corte sin terminar, la venta del
// mostrador que ya descontó el stock.

func (e *entorno) estadoYNota(t *testing.T, pedido string) (string, string) {
	t.Helper()
	var estado, nota string
	if err := e.pool.QueryRow(context.Background(), `
		select o.estado::text, coalesce(h.nota, '') from orders o left join order_status_history h on h.order_id = o.id
		where o.id = $1 order by h.created_at desc nulls last, h.id desc limit 1`, pedido).Scan(&estado, &nota); err != nil {
		t.Fatal(err)
	}
	return estado, nota
}

func (e *entorno) firmar(t *testing.T, remito string) {
	t.Helper()
	token := e.uno(t, `select firma_token from deliveries where numero = $1`, remito)
	if _, err := e.s.RegistrarFirma(context.Background(), FormFirma{Token: token, ReceptorNombre: "Quien Recibe", Firma: "data:image/png;base64,AAAA"}, nil); err != nil {
		t.Fatal(err)
	}
}

// El envío que sale en dos viajes: el primero deja el pedido en camino, la
// firma lo devuelve a listo con lo que falta, y el segundo viaje firmado lo
// entrega. Antes el pedido seguía «listo» con el total, como si no hubiera
// salido nada.
func TestEnvioEnDosViajes(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, r2 := e.pedido(t, "PED-2001", "listo", nil)
	e.exec(t, `update orders set tipo_entrega = 'envio' where id = $1`, pedido)
	e.exec(t, `insert into order_status_history (order_id, estado) values ($1, 'listo')`, pedido)
	u := e.srv.URL + "/api/v1/admin/remitos"

	c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "envio", "cantidades": cantidades(r1, "10")})
	if c != 200 || !strings.Contains(b, "El resto queda por llevar.") {
		t.Fatalf("primer viaje: %d %s", c, b)
	}
	if estado, nota := e.estadoYNota(t, pedido); estado != "en-camino" || nota != "Remito REM-0001: salió en camino una parte" {
		t.Fatalf("en el camión: %q %q", estado, nota)
	}
	e.firmar(t, "REM-0001")
	if estado, nota := e.estadoYNota(t, pedido); estado != "listo" || nota != "Remito REM-0001 firmado: falta llevar el resto" {
		t.Fatalf("vuelto el camión: %q %q", estado, nota)
	}

	c, b = pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "envio", "cantidades": cantidades(r2, "4")})
	if c != 200 || !strings.Contains(b, "El pedido sale en camino.") {
		t.Fatalf("segundo viaje: %d %s", c, b)
	}
	e.firmar(t, "REM-0002")
	if estado, nota := e.estadoYNota(t, pedido); estado != "entregado" || !strings.HasSuffix(nota, "Remito REM-0002 firmado") {
		t.Fatalf("entregado: %q %q", estado, nota)
	}
}

// Anular el remito del camión devuelve el pedido a donde estaba.
func TestAnularElRemitoDelCamion(t *testing.T) {
	e := armar(t)
	ven, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, r2 := e.pedido(t, "PED-2002", "listo", nil)
	e.exec(t, `update orders set tipo_entrega = 'envio' where id = $1`, pedido)
	e.exec(t, `insert into order_status_history (order_id, estado) values ($1, 'listo')`, pedido)
	c, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/remitos", map[string]any{"orderId": pedido, "tipo": "envio", "cantidades": cantidades(r1, "10", r2, "4")})
	if c != 200 {
		t.Fatalf("%d %s", c, b)
	}
	if err := e.s.AnularEntrega(context.Background(), ses, e.uno(t, `select id::text from deliveries where numero = 'REM-0001'`)); err != nil {
		t.Fatal(err)
	}
	if estado, nota := e.estadoYNota(t, pedido); estado != "listo" || !strings.Contains(nota, "anulado") {
		t.Fatalf("anulado: %q %q", estado, nota)
	}
}

// El corte sin terminar no deja completar el pedido; terminado, sale con
// él y queda retirado.
func TestElCorteSaleConElPedido(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, r2 := e.pedido(t, "PED-2003", "listo", nil)
	corte := e.uno(t, `insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado)
		values ('CRT-3', $1, 'Marta', 'Melamina 18', 'en-cola') returning id::text`, pedido)
	u := e.srv.URL + "/api/v1/admin/remitos"
	c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "20111222",
		"cantidades": cantidades(r1, "10", r2, "4")})
	if c != 422 || !strings.Contains(b, "El corte CRT-3 todavía no salió de la máquina") {
		t.Fatalf("con el corte en cola: %d %s", c, b)
	}
	// Lo que no completa el pedido sale igual.
	if c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "20111222",
		"cantidades": cantidades(r2, "4")}); c != 200 {
		t.Fatalf("parcial: %d %s", c, b)
	}
	e.exec(t, `update cutting_orders set estado = 'terminado' where id = $1`, corte)
	if c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "20111222",
		"cantidades": cantidades(r1, "10")}); c != 200 {
		t.Fatalf("con el corte terminado: %d %s", c, b)
	}
	if estado := e.uno(t, `select estado::text from cutting_orders where id = $1`, corte); estado != "retirado" {
		t.Errorf("el corte quedó %q", estado)
	}
	if estado, _ := e.estadoYNota(t, pedido); estado != "entregado" {
		t.Errorf("el pedido quedó %q", estado)
	}
}

// La venta del mostrador que ya descontó el stock (la que lleva un corte y
// queda en curso): el remito no vuelve a sacarlo.
func TestElRemitoDeUnaVentaQueYaDescontoNoSacaOtraVez(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, r2 := e.pedido(t, "PED-2004", "listo", nil)
	e.exec(t, `update stock_reservations set estado = 'liberada' where order_id = $1`, pedido)
	e.exec(t, `update inventory set reservado = 0, qty = qty - 10 where variant_id = $1`, e.variante)
	e.exec(t, `insert into inventory_movements (variant_id, branch_id, type, qty, note) values ($1, $2, 'venta', -10, 'Mostrador PED-2004')`, e.variante, e.sucursal)
	antes := e.uno(t, `select qty::text from inventory where variant_id = $1`, e.variante)
	if c, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/remitos", map[string]any{"orderId": pedido, "tipo": "retiro",
		"receptorDocumento": "20111222", "cantidades": cantidades(r1, "10", r2, "4")}); c != 200 {
		t.Fatalf("%d %s", c, b)
	}
	if despues := e.uno(t, `select qty::text from inventory where variant_id = $1`, e.variante); despues != antes {
		t.Errorf("el stock bajó otra vez: %s → %s", antes, despues)
	}
}

// Un remito que ya firmó el cliente no se anula con un toque: pide el
// motivo y el PIN de un admin, y el motivo queda en el historial.
func TestAnularUnRemitoFirmadoPideMotivoYPin(t *testing.T) {
	e := armar(t)
	e.s.ConAutorizacion(autorizacion.Nuevo(e.pool, silencio, "secreto-del-pin-de-prueba"))
	dep, _ := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	adm, _ := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	pedido, r1, _ := e.pedido(t, "PED-2005", "listo", nil)
	if c, b := pedir(t, dep, "POST", e.srv.URL+"/api/v1/admin/remitos", map[string]any{"orderId": pedido, "tipo": "retiro",
		"receptorDocumento": "20111222", "cantidades": cantidades(r1, "10")}); c != 200 {
		t.Fatalf("%d %s", c, b)
	}
	e.firmar(t, "REM-0001")
	remito := e.uno(t, `select id::text from deliveries where numero = 'REM-0001'`)
	u := e.srv.URL + "/api/v1/admin/remitos/" + remito + "/anular"

	if c, b := pedir(t, dep, "POST", u, nil); c != 422 || !strings.Contains(b, "motivo") {
		t.Fatalf("sin motivo: %d %s", c, b)
	}
	if c, b := pedir(t, dep, "POST", u, map[string]any{"motivo": "Se cargó dos veces"}); c != 422 || !strings.Contains(b, "pin") {
		t.Fatalf("sin PIN: %d %s", c, b)
	}
	if s := e.uno(t, `select estado::text from deliveries where id = $1`, remito); s != "entregada" {
		t.Fatalf("se anuló sin firma: %s", s)
	}
	if c, b := pedir(t, adm, "POST", u, map[string]any{"motivo": "Se cargó dos veces"}); c != 200 {
		t.Fatalf("el admin: %d %s", c, b)
	}
	if n := e.uno(t, `select count(*)::text from order_status_history where order_id = $1 and nota like 'Remito REM-0001 firmado, anulado: Se cargó dos veces%'`, pedido); n != "1" {
		t.Errorf("el motivo no quedó en el historial: %s", n)
	}
}

// La ficha decía «Entrega parcial» de un remito que se llevó todo: lo
// calcula Go con lo que quedaba al hacerlo, como el PDF. Y el remito dice
// qué parte del renglón sale cortada, y cuánto cobrar en un envío.
func TestElRemitoDiceSiFueParcialYQueSeCorto(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, r2 := e.pedido(t, "PED-2006", "listo", nil)
	e.exec(t, `insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado, variant_id, placas)
		values ('CRT-13', $1, 'Marta', 'Tirante', 'terminado', $2, 8)`, pedido, e.variante)
	u := e.srv.URL + "/api/v1/admin/remitos"
	for _, c := range [][]map[string]string{cantidades(r2, "4"), cantidades(r1, "10")} {
		if st, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "1", "cantidades": c}); st != 200 {
			t.Fatalf("%d %s", st, b)
		}
	}
	remitos, err := e.s.RemitosDelPedido(context.Background(), pedido)
	if err != nil {
		t.Fatal(err)
	}
	// Del más nuevo al más viejo: el último se llevó todo.
	if len(remitos) != 2 || remitos[0].Parcial || !remitos[1].Parcial {
		t.Fatalf("parciales: %+v", remitos)
	}
	completo, err := e.s.RemitoCompleto(context.Background(), remitos[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if c := completo.Lineas[0].Corte; c == nil || *c != "Cortado según CRT-13: 0 piezas de 8 placas · 2 enteras" {
		t.Errorf("el corte del renglón: %v", c)
	}
	if completo.SinCobrar == nil || *completo.SinCobrar != 100 {
		t.Errorf("sin cobrar: %v", completo.SinCobrar)
	}
}

// La obra con dos acopios: la misma visita se lleva de los dos con un solo
// formulario y una sola firma (mes simulado: dos remitos, dos veces el
// nombre y el documento, dos firmas). Lo de otro cliente no entra.
func TestUnaVisitaDosAcopiosUnaFirma(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	_, cliente := e.web(t, "obra@prueba.test")
	_, otroCliente := e.web(t, "otra-obra@prueba.test")
	a, a1, _ := e.pedido(t, "PED-1018", "listo", &cliente)
	b, b1, _ := e.pedido(t, "PED-1115", "listo", &cliente)
	ajeno, x1, _ := e.pedido(t, "PED-1116", "listo", &otroCliente)

	otros, err := e.s.OtrosAcopios(context.Background(), a)
	if err != nil || len(otros) != 1 || otros[0].Numero != "PED-1115" || len(otros[0].Renglones) != 2 {
		t.Fatalf("otros acopios: %+v %v", otros, err)
	}

	u := e.srv.URL + "/api/v1/admin/remitos"
	if c, body := pedir(t, ven, "POST", u, map[string]any{"orderId": a, "tipo": "retiro", "receptorNombre": "Pablo Albañil",
		"receptorDocumento": "20111222", "cantidades": cantidades(a1, "2"),
		"otros": []any{map[string]any{"orderId": ajeno, "cantidades": cantidades(x1, "1")}}}); c != 422 || !strings.Contains(body, "otro cliente") {
		t.Fatalf("lo de otro cliente: %d %s", c, body)
	}
	c, body := pedir(t, ven, "POST", u, map[string]any{"orderId": a, "tipo": "retiro", "receptorNombre": "Pablo Albañil",
		"receptorDocumento": "20111222", "cantidades": cantidades(a1, "2"),
		"otros": []any{map[string]any{"orderId": b, "cantidades": cantidades(b1, "3")}}})
	if c != 200 || !strings.Contains(body, "REM-0001 y REM-0002") {
		t.Fatalf("la visita: %d %s", c, body)
	}
	if v := e.uno(t, `select coalesce((select numero from deliveries d2 where d2.id = d.visita_de), '-') from deliveries d where numero = 'REM-0002'`); v != "REM-0001" {
		t.Fatalf("visita de: %s", v)
	}
	token := e.uno(t, `select firma_token from deliveries where numero = 'REM-0001'`)
	r, err := e.s.RemitoPorToken(context.Background(), token)
	if err != nil || len(r.Visita) != 1 || r.Visita[0].PedidoNumero != "PED-1115" {
		t.Fatalf("el enlace no trae la visita: %+v %v", r, err)
	}
	e.firmar(t, "REM-0001")
	if n := e.uno(t, `select count(*)::text from deliveries where firmado_at is not null and receptor_nombre = 'Quien Recibe'`); n != "2" {
		t.Errorf("firmados: %s", n)
	}
	if q := e.uno(t, `select reservado::text from inventory where variant_id = $1`, e.variante); q != "25.000" {
		t.Errorf("reservado después de la visita (30 − 2 − 3): %s", q)
	}
	_ = ajeno
}
