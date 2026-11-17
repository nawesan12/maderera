package facturacion

import (
	"testing"

	"mjbj/internal/sqlc"
)

// Un pedido de la tienda con el 10 % por transferencia: los renglones van a
// precio lleno y el descuento en el pedido. La factura sale por lo cobrado.
func TestFacturaDelPedidoConDescuento(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	var pedido string
	e.uno(t, `INSERT INTO orders (numero, contacto_nombre, origen, subtotal, descuento, total, medio_pago)
		VALUES ('PED-1000', 'Ana', 'tienda', 24200, 2420, 21780, 'transferencia') RETURNING id`, &pedido)
	e.exec(t, `INSERT INTO order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal) VALUES ($1, 'Placa', 'unidad', 2, 12100, 24200)`, pedido)
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+pedido+"/facturar", nil); st != 200 {
		t.Fatalf("%d %s", st, b)
	}
	var total string
	e.uno(t, `SELECT total::text FROM invoices WHERE order_id = $1`, &total, pedido)
	if total != "21780.00" {
		t.Fatalf("el pedido cobró 21780.00 y la factura sale por %s", total)
	}
}
