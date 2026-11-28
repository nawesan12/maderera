package reportes

import (
	"context"
	"testing"
	"time"
)

// M2S1-058 (otra vez): la venta del mostrador guarda el pago con tarjeta
// como «credito» o «debito». La tarjeta «Tarjetas a acreditar» del cierre
// solo sumaba «tarjeta»: decía $ 0,00 con 169.000 en 1.1.13 y, al liquidar
// 160.000, −$ 160.000. Tiene que decir lo mismo que el mayor.
func TestTarjetasSinLiquidarEsElMayor(t *testing.T) {
	e := armar(t)
	placa, _ := e.catalogo(t)
	a := e.pedido(t, "PED-1001", e.central, "entregado", "mostrador", time.Date(2026, 10, 3, 12, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 100000.0, 0.0})
	e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, created_at)
		values ($1, 'pedido', 'mostrador', 'credito', 100000, 'aprobado', '2026-10-03T15:00:00Z')`, a)
	e.facturaConCae(t, nil, 1, 100000, "2026-10-03T15:00:00Z", &a)
	b := e.pedido(t, "PED-1002", e.central, "entregado", "mostrador", time.Date(2026, 10, 4, 12, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 69000.0, 0.0})
	p := e.id(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, created_at)
		values ($1, 'pedido', 'mostrador', 'debito', 69000, 'aprobado', '2026-10-04T15:00:00Z') returning id`, b)
	e.facturaConCae(t, nil, 2, 69000, "2026-10-04T15:00:00Z", &b)
	// Se devolvieron 4.000 de la de débito.
	e.exec(t, `insert into payment_refunds (payment_id, importe, acumulado, created_at) values ($1, 4000, 4000, '2026-10-05T15:00:00Z')`, p)

	fin := time.Date(2026, 10, 31, 23, 0, 0, 0, Argentina)
	mayor := func() float64 { return cuenta(e.asientosDe(t, "2026-10"), Cuentas.TarjetasAAcreditar) }
	if v, err := e.s.TarjetasSinLiquidar(context.Background(), fin); err != nil || v != 165000 || v != mayor() {
		t.Errorf("antes de liquidar: %v (mayor %v) %v", v, mayor(), err)
	}
	if err := e.s.CargarLiquidacion(context.Background(), Liquidacion{Fecha: time.Date(2026, 10, 6, 12, 0, 0, 0, Argentina), Bruto: 160000, Comision: 9000}, ""); err != nil {
		t.Fatal(err)
	}
	if v, err := e.s.TarjetasSinLiquidar(context.Background(), fin); err != nil || v != 5000 || v != mayor() {
		t.Errorf("después de liquidar: %v (mayor %v) %v", v, mayor(), err)
	}
}
