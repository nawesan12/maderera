package facturacion

import (
	"testing"

	"mjbj/internal/sqlc"
)

// Mes simulado 2 (M2S2-010, M2S2-015, M3S4-034): la factura de un pedido de
// contado cobrada desde Facturación dejaba el pedido «pendiente» (el remito
// decía «Pendiente de pago») y la cuenta del cliente con un saldo a favor
// igual a lo cobrado, que nadie debía. Ahora el pago no toca la cuenta, el
// pedido queda pagado y su forma de pago es la del cobro (M2S3-039).
func TestCobrarLaFacturaDeUnPedidoDeContado(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	var cliente, pedido, factura string
	e.uno(t, `INSERT INTO customers (nombre) VALUES ('Sim Valeria') RETURNING id`, &cliente)
	e.uno(t, `INSERT INTO orders (numero, contacto_nombre, origen, subtotal, total, estado, estado_pago, medio_pago, customer_id)
		VALUES ('PED-1081', 'Valeria', 'presupuesto', 289500, 289500, 'listo', 'pendiente', 'efectivo', $1) RETURNING id`, &pedido, cliente)
	e.exec(t, `INSERT INTO order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal) VALUES ($1, 'Placa', 'unidad', 1, 289500, 289500)`, pedido)
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+pedido+"/facturar", nil); st != 200 {
		t.Fatalf("facturar: %d %s", st, b)
	}
	e.uno(t, `SELECT id FROM invoices WHERE order_id = $1`, &factura, pedido)
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+factura+"/cobros",
		map[string]string{"modo": "recibo", "partes": `[{"medio":"transferencia","importe":"289500"}]`}); st != 200 {
		t.Fatalf("cobrar: %d %s", st, b)
	}
	var estado, medio string
	var saldo float64
	e.uno(t, `SELECT estado_pago::text FROM orders WHERE id = $1`, &estado, pedido)
	e.uno(t, `SELECT medio_pago::text FROM orders WHERE id = $1`, &medio, pedido)
	e.uno(t, `SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE customer_id = $1`, &saldo, cliente)
	if estado != "pagado" || medio != "transferencia" || saldo != 0 {
		t.Fatalf("estado %s, medio %s, cuenta %v", estado, medio, saldo)
	}
}
