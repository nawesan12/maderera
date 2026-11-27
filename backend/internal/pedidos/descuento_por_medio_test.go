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

// Mes 23: PED-1123 se pasó a pedido por transferencia y se cobró en
// efectivo con un recibo; la ficha decía «10% por transferencia».
func TestElMotivoDelDescuentoEsElDelMedioConQueSeCobro(t *testing.T) {
	e := armar(t)
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.exec(t, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta, activo) values
		('transferencia', 0, 10, '10% por transferencia', true), ('efectivo', 0, 10, '10% en efectivo', true)`)
	transferencia := "transferencia"
	r, err := e.s.ConvertirConEntrega(t.Context(), ses, e.presupuesto(t, ses, 2), Entrega{MedioPago: &transferencia})
	if err != nil {
		t.Fatal(err)
	}
	motivo := func() string {
		t.Helper()
		f, err := e.s.Pedido(t.Context(), r.ID, false)
		if err != nil || f == nil || f.DescuentoMotivo == nil {
			t.Fatalf("ficha: %+v %v", f, err)
		}
		return *f.DescuentoMotivo
	}
	if m := motivo(); m != "10% por transferencia" {
		t.Errorf("antes de cobrar: %q", m)
	}
	e.exec(t, `update orders set estado_pago = 'pagado' where id = $1`, r.ID)
	e.exec(t, `with rc as (insert into receipts (numero, recibido_de, total, estado, origen, order_id)
		values ('REC-0901', 'Cliente', 1, 'emitido', 'panel', $1) returning id)
		insert into receipt_parts (receipt_id, medio, importe) select id, 'efectivo', 1 from rc`, r.ID)
	if m := motivo(); m != "10% en efectivo" {
		t.Errorf("cobrado en efectivo: %q", m)
	}
}
