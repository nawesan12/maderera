package pedidos

import (
	"net/http"
	"strings"
	"testing"

	"mjbj/internal/facturacion"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas/fragmentos"
)

// El pedido partido (H047): con $50.000 de crédito, un presupuesto de
// $96.500,50 deja $50.000 a cuenta y el resto por transferencia. El límite
// se mira solo sobre la parte a cuenta; el resto es un pedido de contado
// (sin cobrar en «Me deben», cobrado con un recibo del pedido que no toca
// la cuenta) y, cobrado, el pedido queda «parcial». Cancelarlo devuelve solo
// lo de la cuenta.
func TestPedidoPartidoEntreLaCuentaYOtroMedio(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	_, cliente := e.web(t, "cliente@prueba.test")
	u := e.srv.URL + "/api/v1/admin/"
	e.exec(t, `update customers set limite_credito = 50000 where id = $1`, cliente)
	nuevo := func() string {
		c, b := pedir(t, ven, "POST", u+"presupuestos", e.alta("Obra Ferreyra", 1, map[string]any{"customerId": cliente}))
		if c != 200 {
			t.Fatalf("alta: %d %s", c, b)
		}
		return leer[Resultado](t, b).ID
	}
	p := nuevo()
	pasar := func(cuerpo map[string]any) (int, string) {
		return pedir(t, ven, "POST", u+"presupuestos/"+p+"/pedido", cuerpo)
	}
	if c, b := pasar(map[string]any{"medioPago": "cuenta_corriente"}); c != 422 || !strings.Contains(b, "límite") {
		t.Fatalf("todo a cuenta: %d %s", c, b)
	}
	if c, b := pasar(map[string]any{"medioPago": "cuenta_corriente", "aCuenta": 50000.0}); c != 422 || !strings.Contains(b, "Elegí cómo paga el resto.") {
		t.Fatalf("sin medio para el resto: %d %s", c, b)
	}
	if c, b := pasar(map[string]any{"medioPago": "transferencia", "aCuenta": 60000.0}); c != 422 || !strings.Contains(b, "límite") {
		t.Fatalf("la parte pasa el límite: %d %s", c, b)
	}
	c, b := pasar(map[string]any{"medioPago": "transferencia", "aCuenta": 50000.0})
	if c != 200 {
		t.Fatalf("partido: %d %s", c, b)
	}
	pedido := leer[Resultado](t, b)
	if got := e.texto(t, `select medio_pago::text || ' ' || a_cuenta::text || ' ' || total::text from orders where id = $1`, pedido.ID); got != "transferencia 50000.00 96500.50" {
		t.Fatalf("pedido: %s", got)
	}
	if d := e.numero(t, `select coalesce(sum(monto),0)::float8 from account_movements where customer_id = $1 and referencia = $2 and tipo = 'compra'`, cliente, pedido.Numero); d != 50000 {
		t.Fatalf("a la cuenta: %v", d)
	}
	sinCobrar := func() float64 {
		return e.numero(t, `select coalesce(`+fragmentos.SinCobrarDelPedido+`, 0)::float8 from orders o where o.id = $1`, pedido.ID)
	}
	if s := sinCobrar(); s != 46500.5 {
		t.Fatalf("sin cobrar: %v", s)
	}
	// Su factura debe las dos cosas: el resto y lo que la cuenta debe.
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, order_id, customer_id)
		values ('factura_b', 1, 1, 'Obra Ferreyra', 79752.48, 16748.02, 0, 0, 0, 96500.50, 'emitida', now(), $1, $2)`, pedido.ID, cliente)
	saldoDeFactura := func() float64 {
		return e.numero(t, `select `+facturacion.SaldoDeFactura+`::float8 from invoices i
			left join (select invoice_id, sum(monto) as cobrado, sum(monto) filter (where medio <> 'cuenta_corriente') as cobrado_contado
			           from invoice_payments group by invoice_id) c on c.invoice_id = i.id
			left join orders o on o.id = i.order_id where i.order_id = $1`, pedido.ID)
	}
	if f := saldoDeFactura(); f != 96500.5 {
		t.Errorf("saldo de la factura: %v", f)
	}
	if nota := e.texto(t, `select nota from order_status_history where order_id = $1`, pedido.ID); !strings.Contains(nota, "$ 50.000 a cuenta corriente y $ 46.500,50 por cobrar") {
		t.Errorf("historial: %s", nota)
	}

	// El cobro del pedido es el resto: no más.
	cobrar := func(importe string) (int, string) {
		return pedir(t, ven, "POST", u+"pedidos/"+pedido.ID+"/cobro", map[string]any{"partes": `[{"medio":"transferencia","importe":"` + importe + `"}]`})
	}
	if c, b := cobrar("96500.50"); c != 422 || !strings.Contains(b, "le faltan") {
		t.Fatalf("cobrar el total: %d %s", c, b)
	}
	if c, b := cobrar("46500.50"); c != 200 {
		t.Fatalf("cobrar el resto: %d %s", c, b)
	}
	if m := e.texto(t, `select estado_pago::text from orders where id = $1`, pedido.ID); m != "parcial" {
		t.Errorf("después del resto: %s", m)
	}
	if s := sinCobrar(); s != 0 {
		t.Errorf("sin cobrar después del resto: %v", s)
	}
	if f := saldoDeFactura(); f != 50000 {
		t.Errorf("saldo de la factura después del resto: %v", f)
	}
	// El recibo del resto no toca la cuenta: sigue debiendo la parte.
	if d := e.numero(t, `select coalesce(sum(monto),0)::float8 from account_movements where customer_id = $1`, cliente); d != 50000 {
		t.Errorf("la cuenta: %v", d)
	}

	// Lo que cubre el total es un pedido a cuenta de siempre.
	e.exec(t, `update customers set limite_credito = 1000000 where id = $1`, cliente)
	p = nuevo()
	c, b = pasar(map[string]any{"medioPago": "transferencia", "aCuenta": 200000.0})
	if c != 200 {
		t.Fatalf("todo a cuenta por la parte: %d %s", c, b)
	}
	entero := leer[Resultado](t, b)
	if got := e.texto(t, `select medio_pago::text || ' ' || coalesce(a_cuenta::text, '-') from orders where id = $1`, entero.ID); got != "cuenta_corriente -" {
		t.Errorf("la parte que cubre el total: %s", got)
	}

	// Cancelar uno partido sin cobrar devuelve lo de la cuenta.
	p = nuevo()
	c, b = pasar(map[string]any{"medioPago": "efectivo", "aCuenta": 30000.0})
	if c != 200 {
		t.Fatalf("otro partido: %d %s", c, b)
	}
	otro := leer[Resultado](t, b)
	// Corregirlo cambia el resto: subir el precio no toca la cuenta, y bajar
	// el total por debajo de la parte a cuenta la baja hasta el total.
	placa := e.texto(t, `select id::text from order_items where order_id = $1 and variant_id is not null`, otro.ID)
	corregir := func(c *http.Client, precio float64) {
		t.Helper()
		if st, b := pedir(t, c, "POST", u+"pedidos/"+otro.ID+"/correccion", map[string]any{"renglones": []any{
			map[string]any{"orderItemId": placa, "cantidad": 1, "precioUnitario": precio}}, "costoEnvio": 0, "motivo": "Precio"}); st != 200 {
			t.Fatalf("corregir a %v: %d %s", precio, st, b)
		}
	}
	corregir(ven, 90000)
	if d := e.numero(t, `select coalesce(sum(monto),0)::float8 from account_movements where referencia = $1`, otro.Numero); d != 30000 {
		t.Errorf("la cuenta después de subir: %v", d)
	}
	adm, _ := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	corregir(adm, 10000)
	// 10.000 de la placa + 12.000,50 del flete: la parte baja a 22.000,50.
	if got := e.texto(t, `select a_cuenta::text from orders where id = $1`, otro.ID); got != "22000.50" {
		t.Errorf("parte a cuenta: %s", got)
	}
	if d := e.numero(t, `select coalesce(sum(monto),0)::float8 from account_movements where referencia = $1`, otro.Numero); d != 22000.5 {
		t.Errorf("la cuenta después de bajar: %v", d)
	}
	if s := e.numero(t, `select coalesce(`+fragmentos.SinCobrarDelPedido+`, 0)::float8 from orders o where o.id = $1`, otro.ID); s != 0 {
		t.Errorf("resto después de bajar: %v", s)
	}
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+otro.ID+"/cancelar", map[string]any{"motivo": "Se arrepintió"}); c != 200 {
		t.Fatalf("cancelar: %d %s", c, b)
	}
	if d := e.numero(t, `select coalesce(sum(monto),0)::float8 from account_movements where customer_id = $1 and referencia = $2`, cliente, otro.Numero); d != 0 {
		t.Errorf("deuda después de cancelar: %v", d)
	}
}
