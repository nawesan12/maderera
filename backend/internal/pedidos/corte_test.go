package pedidos

import (
	"context"
	"testing"

	"mjbj/internal/entregas"
	"mjbj/internal/sqlc"
)

// Mes simulado 2 (M2S2-066, M3S1-053): el pedido que solo lleva el corte
// sale con el remito de sus piezas, con quien retira, para firmar.
func TestEntregarElPedidoDelCorteHaceElRemito(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido := e.id(t, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, estado_pago, medio_pago, subtotal, total)
		values ('PED-1026', 'Sim Hernán', $1, 'mostrador', 'listo', 'pagado', 'efectivo', 4800, 4800) returning id`, e.sucursal)
	e.exec(t, `insert into order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal, del_corte) values ($1, 'Corte a medida', 'pasada', 4, 1200, 4800, true)`, pedido)
	e.exec(t, `insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado, placas) values ('CRT-4', $1, 'Sim Hernán', 'MDF', 'terminado', 1)`, pedido)
	nombre, documento := "Sim Lucía", "30555201"
	r, err := e.s.Avanzar(ctx, ses, pedido, "listo", entregas.NuevoReceptor(&nombre, &documento))
	if err != nil {
		t.Fatal(err)
	}
	if r.FirmaToken == "" {
		t.Fatal("sin remito para firmar")
	}
	if d := e.texto(t, `select receptor_nombre || ' ' || receptor_documento from deliveries where order_id = $1 and cutting_order_id is not null`, pedido); d != "Sim Lucía 30555201" {
		t.Errorf("quien retiró: %q", d)
	}
}
