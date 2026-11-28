package caja

import "testing"

// Las devoluciones de un mismo medio van en una fila, con quién hizo las
// parciales: «Efectivo» y «Efectivo · Prueba vendedor» salían separadas en el
// cierre del turno (mes simulado).
func TestDevolucionesJuntasPorMedio(t *testing.T) {
	vendedor, otro := "Prueba vendedor", "Ana"
	rs := juntarDevoluciones([]RenglonDelCierre{
		{MedioPago: "efectivo", Cantidad: 3, Total: 1000},
		{MedioPago: "efectivo", Cantidad: 1, Total: -500, Devolucion: true},
		{MedioPago: "efectivo", Cantidad: 2, Total: -6660.4, Devolucion: true, Quien: &vendedor},
		{MedioPago: "efectivo", Cantidad: 1, Total: -100, Devolucion: true, Quien: &otro},
		{MedioPago: "cuenta_corriente", Cantidad: 1, Total: -300, Devolucion: true, Quien: &vendedor},
	})
	if len(rs) != 3 {
		t.Fatalf("filas: %+v", rs)
	}
	if e := rs[1]; e.MedioPago != "efectivo" || e.Cantidad != 4 || e.Total != -7260.4 || e.Quien == nil || *e.Quien != "Prueba vendedor, Ana" {
		t.Errorf("efectivo: %+v", e)
	}
	if c := rs[2]; c.Total != -300 || c.Quien == nil || *c.Quien != vendedor {
		t.Errorf("cuenta: %+v", c)
	}
	if rs[0].Devolucion || rs[0].Total != 1000 {
		t.Errorf("la venta: %+v", rs[0])
	}
}

// Las anulaciones nombran sus pedidos como las parciales: «Efectivo ·
// PED-1127, PED-1134 (6)» eran 2 parciales de 6 devoluciones y se leía como
// si esos dos sumaran todo (mes 23, M2S1-081). Una venta en los dos grupos
// sale una vez.
func TestDevolucionesNombranTodosLosPedidos(t *testing.T) {
	anuladas, parciales := "PED-1127, PED-999", "PED-1127, PED-1134"
	rs := juntarDevoluciones([]RenglonDelCierre{
		{MedioPago: "efectivo", Cantidad: 2, Total: -500, Devolucion: true, Pedidos: &anuladas},
		{MedioPago: "efectivo", Cantidad: 2, Total: -100, Devolucion: true, Pedidos: &parciales},
	})
	if len(rs) != 1 || rs[0].Pedidos == nil || *rs[0].Pedidos != "PED-999, PED-1127, PED-1134" {
		t.Fatalf("filas: %+v", rs)
	}
}
