package pedidos

import (
	"testing"

	"mjbj/internal/sqlc"
)

// Mes simulado 2 (M2S1-080): el presupuesto pasado a pedido por
// transferencia cobraba la lista, y el mismo carrito salía 10 % menos en el
// mostrador. El descuento por forma de pago va sobre lo del catálogo (no
// sobre el flete cargado a mano) y queda en el pedido; a cuenta corriente o
// sin medio, no.
func TestElPedidoDeUnPresupuestoLlevaElDescuentoPorFormaDePago(t *testing.T) {
	e := armar(t)
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.exec(t, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta, activo) values ('transferencia', 0, 10, 'Transferencia -10%', true)`)
	transferencia := "transferencia"
	r, err := e.s.ConvertirConEntrega(t.Context(), ses, e.presupuesto(t, ses, 2), Entrega{MedioPago: &transferencia})
	if err != nil {
		t.Fatal(err)
	}
	// 2 × 84.500 = 169.000; el 10 % es 16.900; el flete (12.000,50) va entero.
	if d := e.numero(t, `select descuento from orders where id = $1`, r.ID); d != 16900 {
		t.Errorf("descuento: %v", d)
	}
	if total := e.numero(t, `select total from orders where id = $1`, r.ID); total != 169000-16900+12000.5 {
		t.Errorf("total: %v", total)
	}
	if m := e.texto(t, `select descuento_motivo from orders where id = $1`, r.ID); m != "Transferencia -10%" {
		t.Errorf("motivo: %q", m)
	}
	// Sin medio, la lista.
	r, err = e.s.ConvertirConEntrega(t.Context(), ses, e.presupuesto(t, ses, 2), Entrega{})
	if err != nil {
		t.Fatal(err)
	}
	if d := e.numero(t, `select descuento from orders where id = $1`, r.ID); d != 0 {
		t.Errorf("sin medio: %v", d)
	}
}
