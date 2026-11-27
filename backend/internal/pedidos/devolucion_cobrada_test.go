package pedidos

import (
	"strings"
	"testing"

	"mjbj/internal/jsmath"
	"mjbj/internal/sqlc"
)

// Mes simulado 2 (M2S1-023, M3S4-003): el pedido de un presupuesto pasado
// sin forma de pago (medio_pago NULL), con cliente, cobrado por recibo y
// entregado, daba 500 al devolver («cannot scan NULL into *bool»).
//
// Y M2S2-022: cobrado y sin factura, la devolución se frenaba sin otra
// salida. Ahora elige por dónde vuelve la plata, con el tope de lo que entró
// por ahí: por afuera (la transferencia) y por la caja (el efectivo, con la
// caja abierta).
func TestDevolucionDeUnPedidoCobradoSinFormaDePago(t *testing.T) {
	e := armar(t)
	ven, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido := e.pedido(t, ses, 2)
	cliente := e.id(t, `insert into customers (nombre) values ('Sim Lucía') returning id`)
	e.exec(t, `update orders set customer_id = $2, medio_pago = null, estado = 'entregado' where id = $1`, pedido, cliente)
	total := e.numero(t, `select total from orders where id = $1`, pedido)
	u := e.srv.URL + "/api/v1/admin/pedidos/" + pedido
	if c, b := pedir(t, ven, "POST", u+"/cobro", map[string]any{"partes": `[{"medio":"transferencia","importe":"` + texto2(total) + `"}]`, "clave": "c-1"}); c != 200 {
		t.Fatalf("cobrar: %d %s", c, b)
	}
	placa := e.texto(t, `select id::text from order_items where order_id = $1 and variant_id is not null`, pedido)

	// Sin destino: ya está cobrado, y lo dice (antes, 500).
	cuerpo := map[string]any{"renglones": []any{map[string]any{"orderItemId": placa, "cantidad": 1}}, "motivo": "Sobró", "clave": "d-1"}
	if c, b := pedir(t, ven, "POST", u+"/devolucion", cuerpo); c != 422 || !strings.Contains(b, "ya está cobrado") {
		t.Fatalf("sin destino: %d %s", c, b)
	}
	// El diálogo sabe por dónde puede volver.
	c, b := pedir(t, ven, "GET", u+"/devolucion", nil)
	if c != 200 || !strings.Contains(b, `"caja":0`) || !strings.Contains(b, `"afuera":`+texto2(total)) {
		t.Fatalf("datos: %d %s", c, b)
	}
	// Por la caja no: no entró en efectivo.
	cuerpo["destino"] = "caja"
	if c, b := pedir(t, ven, "POST", u+"/devolucion", cuerpo); c != 422 || !strings.Contains(b, "no se cobró en efectivo") {
		t.Fatalf("por la caja: %d %s", c, b)
	}
	// Por afuera, sí: queda el tramo en el recibo y la placa vuelve.
	cuerpo["destino"] = "afuera"
	cuerpo["clave"] = "d-2"
	if c, b := pedir(t, ven, "POST", u+"/devolucion", cuerpo); c != 200 {
		t.Fatalf("por afuera: %d %s", c, b)
	}
	importe := e.numero(t, `select importe from devoluciones where order_id = $1`, pedido)
	if n := e.numero(t, `select coalesce(sum(importe), 0) from receipt_refunds`); n != importe || importe <= 0 {
		t.Errorf("tramo del recibo: %v, devuelto %v", n, importe)
	}
	if d := e.texto(t, `select destino from devoluciones where order_id = $1`, pedido); d != "afuera" {
		t.Errorf("destino: %s", d)
	}
	if n := e.numero(t, `select count(*) from order_status_history where order_id = $1 and nota like 'Devolución · 1 %Vuelve por el banco'`, pedido); n != 1 {
		t.Errorf("historial: %v", n)
	}
	// Queda 1 por devolver.
	if _, b := pedir(t, ven, "GET", u+"/devolucion", nil); !strings.Contains(b, `"queda":1`) {
		t.Errorf("lo que queda: %s", b)
	}
}

// En efectivo, por la caja de la sucursal y con la caja abierta.
func TestDevolucionCobradaEnEfectivoSalePorLaCaja(t *testing.T) {
	e := armar(t)
	ven, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido := e.pedido(t, ses, 1)
	e.exec(t, `update orders set medio_pago = 'efectivo', estado = 'entregado' where id = $1`, pedido)
	turno := e.id(t, `insert into cash_sessions (branch_id, abierta_por) values ($1, (select id from "user" where email = 'vendedor@prueba.test')) returning id`, e.sucursal)
	total := e.numero(t, `select total from orders where id = $1`, pedido)
	u := e.srv.URL + "/api/v1/admin/pedidos/" + pedido
	if c, b := pedir(t, ven, "POST", u+"/cobro", map[string]any{"partes": `[{"medio":"efectivo","importe":"` + texto2(total) + `"}]`, "clave": "c-1"}); c != 200 {
		t.Fatalf("cobrar: %d %s", c, b)
	}
	placa := e.texto(t, `select id::text from order_items where order_id = $1 and variant_id is not null`, pedido)
	cuerpo := map[string]any{"renglones": []any{map[string]any{"orderItemId": placa, "cantidad": 1}}, "motivo": "No era", "clave": "d-1", "destino": "caja"}
	if c, b := pedir(t, ven, "POST", u+"/devolucion", cuerpo); c != 200 {
		t.Fatalf("por la caja: %d %s", c, b)
	}
	if m := e.numero(t, `select coalesce(sum(monto), 0) from cash_movements where session_id = $1`, turno); m != total-84500 {
		t.Errorf("la caja después de cobrar y devolver la placa: %v", m)
	}
}

func texto2(x float64) string { return jsmath.Texto(x) }
