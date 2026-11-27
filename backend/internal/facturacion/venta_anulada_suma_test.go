package facturacion

import (
	"context"
	"testing"

	"mjbj/internal/sqlc"
)

// La factura sin CAE de una venta anulada no suma en el encabezado de
// Facturación ni en el resumen: son ventas que no existen (M2S2-034).
func TestLaFacturaSinCAEDeUnaVentaAnuladaNoSuma(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	var pedido string
	e.uno(t, `INSERT INTO orders (numero, contacto_nombre, origen, subtotal, total, estado, estado_pago, medio_pago)
		VALUES ('PED-1043', 'Ana', 'mostrador', 188000, 188000, 'entregado', 'pendiente', 'efectivo') RETURNING id`, &pedido)
	e.exec(t, `INSERT INTO order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal) VALUES ($1, 'Placa', 'unidad', 1, 188000, 188000)`, pedido)
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+pedido+"/facturar", nil); st != 200 {
		t.Fatalf("facturar: %d %s", st, b)
	}
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(consumidor(), [4]string{"Flete", "1", "9000", "21"})); st != 200 {
		t.Fatalf("manual: %d %s", st, b)
	}
	e.exec(t, `UPDATE orders SET estado = 'cancelado' WHERE id = $1`, pedido)
	_, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/pagina", nil)
	if p := leerJSON[PaginaDeComprobantes](t, b); p.Suma != 9000 || p.Cantidad != 1 || p.Total != 2 {
		t.Fatalf("encabezado: %s", b)
	}
	r, err := e.s.ResumenDe(context.Background(), nil, nil)
	if err != nil || r.TotalMes != 9000 {
		t.Fatalf("resumen: %+v %v", r, err)
	}
}
