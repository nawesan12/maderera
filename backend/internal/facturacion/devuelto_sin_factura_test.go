package facturacion

import (
	"testing"

	"mjbj/internal/sqlc"
)

// Lo que se devolvió antes de facturar (la devolución de un pedido sin
// factura, mes simulado) no se factura: ni la cantidad ni su plata.
func TestLaFacturaNoLlevaLoDevueltoSinFactura(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	var pedido, renglon, devolucion string
	e.uno(t, `INSERT INTO orders (numero, contacto_nombre, origen, subtotal, total, medio_pago)
		VALUES ('PED-1066', 'Marta', 'presupuesto', 24200, 24200, 'efectivo') RETURNING id`, &pedido)
	e.uno(t, `INSERT INTO order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal)
		VALUES ($1, 'Laca 4 l', 'unidad', 2, 12100, 24200) RETURNING id`, &renglon, pedido)
	e.uno(t, `INSERT INTO devoluciones (clave, order_id, importe, destino, motivo) VALUES ('d1', $1, 12100, 'deuda', 'sin abrir') RETURNING id`, &devolucion, pedido)
	e.exec(t, `INSERT INTO devolucion_items (devolucion_id, order_item_id, cantidad, al_stock, importe) VALUES ($1, $2, 1, true, 12100)`, devolucion, renglon)
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+pedido+"/facturar", nil); st != 200 {
		t.Fatalf("%d %s", st, b)
	}
	var total, cantidad string
	e.uno(t, `SELECT total::text FROM invoices WHERE order_id = $1`, &total, pedido)
	e.uno(t, `SELECT ii.cantidad::text FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.order_id = $1`, &cantidad, pedido)
	if total != "12100.00" || cantidad != "1.000" && cantidad != "1.00" && cantidad != "1" {
		t.Fatalf("la factura salió por %s con %s lacas", total, cantidad)
	}
}
