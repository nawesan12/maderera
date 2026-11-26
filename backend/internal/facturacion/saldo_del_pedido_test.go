package facturacion

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// La factura de una venta cobrada en el mostrador, o de un pedido cobrado
// con un recibo, no queda con todo el saldo ni ofrece cobrarse otra vez
// (simulación del mes, H130/H234). La del pedido a cuenta corriente se debe
// en la cuenta: no es «Cobrado» ni saldo de la factura (H152). La de un
// pedido sin cobrar sigue debiendo lo del pedido. Y el encabezado suma y
// cuenta el mismo conjunto: sin el rechazado (H246).
func TestSaldoDeLaFacturaSaleDelPedido(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	var cliente string
	e.uno(t, `INSERT INTO customers (nombre) VALUES ('Constructora') RETURNING id`, &cliente)
	pedido := func(numero, estadoPago, medio string, total float64, conCliente bool) string {
		var id string
		var c any
		if conCliente {
			c = cliente
		}
		e.uno(t, `INSERT INTO orders (numero, contacto_nombre, origen, subtotal, total, estado, estado_pago, medio_pago, customer_id)
			VALUES ($1, 'Ana', 'mostrador', $2, $2, 'entregado', $3, $4, $5) RETURNING id`, &id, numero, total, estadoPago, medio, c)
		e.exec(t, `INSERT INTO order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal) VALUES ($1, 'Placa', 'unidad', 1, $2, $2)`, id, total)
		if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+id+"/facturar", nil); st != 200 {
			t.Fatalf("facturar %s: %d %s", numero, st, b)
		}
		return id
	}
	contado := pedido("PED-1000", "pagado", "efectivo", 211500, false)
	e.exec(t, `INSERT INTO order_payments (order_id, medio, importe) VALUES ($1, 'efectivo', 211500)`, contado)
	// La venta del mostrador escribe el mismo pago en payments: no se cuenta
	// dos veces (mes simulado, H130 vuelta 2).
	e.exec(t, `INSERT INTO payments (order_id, tipo, proveedor, medio, monto, estado) VALUES ($1, 'pedido', 'mostrador', 'efectivo', 211500, 'aprobado')`, contado)
	conRecibo := pedido("PED-1046", "pendiente", "transferencia", 437120, true)
	e.exec(t, `INSERT INTO receipts (numero, customer_id, recibido_de, total, origen, order_id) VALUES ('REC-0016', $1, 'Constructora', 437120, 'panel', $2)`,
		cliente, conRecibo)
	aCuenta := pedido("PED-1006", "pendiente", "cuenta_corriente", 4113000, true)
	e.exec(t, `INSERT INTO order_payments (order_id, medio, importe) VALUES ($1, 'cuenta_corriente', 4113000)`, aCuenta)
	sinCobrar := pedido("PED-1066", "pendiente", "efectivo", 495400, false)

	facturaDe := func(pedido string) string {
		var id string
		e.uno(t, `SELECT id FROM invoices WHERE order_id = $1`, &id, pedido)
		return id
	}
	for _, c := range []struct {
		pedido   string
		saldo    float64
		enCuenta bool
	}{{contado, 0, false}, {conRecibo, 0, false}, {aCuenta, 0, true}, {sinCobrar, 495400, false}} {
		st, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+facturaDe(c.pedido), nil)
		f := leerJSON[Completo](t, b)
		if st != 200 || f.Saldo != c.saldo || f.EnCuenta != c.enCuenta {
			t.Fatalf("pedido %s: saldo %v (quería %v), en cuenta %v: %s", c.pedido, f.Saldo, c.saldo, f.EnCuenta, b)
		}
	}
	// La del mostrador muestra con qué se cobró, y la sucursal es la de la
	// venta, no la del punto de venta (H341).
	e.exec(t, `INSERT INTO branches (slug, name) VALUES ('aserradero-prueba', 'Aserradero')`)
	e.exec(t, `UPDATE orders SET branch_id = (SELECT id FROM branches WHERE slug = 'aserradero-prueba') WHERE id = $1`, contado)
	_, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+facturaDe(contado), nil)
	if f := leerJSON[Completo](t, b); f.Sucursal == nil || *f.Sucursal != "Aserradero" {
		t.Fatalf("sucursal: %s", b)
	}
	if f := leerJSON[Completo](t, b); len(f.CobrosDelPedido) != 1 || f.CobrosDelPedido[0].Medio != "efectivo" || f.Pedido == nil || *f.Pedido != "PED-1000" {
		t.Fatalf("cobros del pedido: %s", b)
	}
	_, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+facturaDe(conRecibo), nil)
	if f := leerJSON[Completo](t, b); len(f.CobrosDelPedido) != 1 || f.CobrosDelPedido[0].Recibo == nil || *f.CobrosDelPedido[0].Recibo != "REC-0016" {
		t.Fatalf("el recibo del pedido: %s", b)
	}

	// Lo cargado a la cuenta no es un cobro.
	_, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+facturaDe(aCuenta), nil)
	if f := leerJSON[Completo](t, b); len(f.CobrosDelPedido) != 0 {
		t.Fatalf("la cuenta corriente como cobro: %s", b)
	}

	// Y no se deja cobrar otra vez.
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+facturaDe(contado)+"/cobros",
		map[string]string{"modo": "cuenta_corriente", "monto": "211500"}); st != 422 || !strings.Contains(string(b), "ya está cobrada") {
		t.Fatalf("cobrar dos veces: %d %s", st, b)
	}

	// El listado: la misma regla, y el filtro de contado y de cuenta.
	u := e.srv.URL + "/api/v1/admin/facturacion/comprobantes/pagina"
	_, b = pedir(t, admin, "GET", u, nil)
	p := leerJSON[PaginaDeComprobantes](t, b)
	for _, f := range p.Filas {
		saldo := f.Total - f.Cobrado
		if (f.Pedido != nil && *f.Pedido == "PED-1066") != (saldo > 0) {
			t.Fatalf("%v: saldo %v: %s", f.Pedido, saldo, b)
		}
		if f.EnCuenta != (f.Pedido != nil && *f.Pedido == "PED-1006") {
			t.Fatalf("%v: en cuenta %v", f.Pedido, f.EnCuenta)
		}
	}
	_, b = pedir(t, admin, "GET", u+"?cobro=contado", nil)
	if p := leerJSON[PaginaDeComprobantes](t, b); p.Total != 1 || p.Filas[0].Pedido == nil || *p.Filas[0].Pedido != "PED-1000" {
		t.Fatalf("de contado: %s", b)
	}
	_, b = pedir(t, admin, "GET", u+"?cobro=cuenta", nil)
	if p := leerJSON[PaginaDeComprobantes](t, b); p.Total != 1 || *p.Filas[0].Pedido != "PED-1006" {
		t.Fatalf("a cuenta: %s", b)
	}

	// La de cuenta corriente con la cuenta debiendo: debe hasta el saldo de
	// la cuenta y se puede cobrar desde acá (la mixta del mostrador).
	e.exec(t, `INSERT INTO account_movements (customer_id, tipo, monto, referencia) VALUES ($1, 'compra', 1000000, 'PED-1006')`, cliente)
	_, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+facturaDe(aCuenta), nil)
	if f := leerJSON[Completo](t, b); f.Saldo != 1000000 || !f.EnCuenta {
		t.Fatalf("a cuenta con saldo: %s", b)
	}

	// Un rechazo real: no suma ni cuenta en el encabezado, aunque está en la
	// lista.
	e.exec(t, `UPDATE invoices SET estado = 'rechazada' WHERE id = $1`, facturaDe(sinCobrar))
	_, b = pedir(t, admin, "GET", u, nil)
	if p := leerJSON[PaginaDeComprobantes](t, b); p.Total != 4 || p.Cantidad != 3 || p.Suma != 211500+437120+4113000 {
		t.Fatalf("encabezado: %s", b)
	}
}

// La factura sin CAE de una venta anulada: sin saldo, no se cobra y entra
// en «Ventas anuladas con factura viva» para darla de baja (H236).
func TestFacturaSinCaeDeUnaVentaAnulada(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	var pedido, factura string
	e.uno(t, `INSERT INTO orders (numero, contacto_nombre, origen, subtotal, total, estado, estado_pago, medio_pago)
		VALUES ('PED-1017', 'Ana', 'mostrador', 193600, 193600, 'entregado', 'pendiente', 'efectivo') RETURNING id`, &pedido)
	e.exec(t, `INSERT INTO order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal) VALUES ($1, 'Placa', 'unidad', 1, 193600, 193600)`, pedido)
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+pedido+"/facturar", nil); st != 200 {
		t.Fatalf("facturar: %d %s", st, b)
	}
	e.uno(t, `SELECT id FROM invoices WHERE order_id = $1`, &factura, pedido)
	e.exec(t, `UPDATE orders SET estado = 'cancelado' WHERE id = $1`, pedido)

	_, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+factura, nil)
	if f := leerJSON[Completo](t, b); f.Saldo != 0 || !f.VentaAnulada {
		t.Fatalf("factura de la venta anulada: %s", b)
	}
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+factura+"/cobros",
		map[string]string{"modo": "cuenta_corriente", "monto": "100"}); st != 422 || !strings.Contains(string(b), "se anuló") {
		t.Fatalf("cobrar la anulada: %d %s", st, b)
	}
	_, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/pagina?estado=anulada-viva", nil)
	if p := leerJSON[PaginaDeComprobantes](t, b); p.Total != 1 || p.Filas[0].ID != factura {
		t.Fatalf("anuladas con factura viva: %s", b)
	}
}
