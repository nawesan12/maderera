package reportes

import (
	"context"
	"strings"
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

// Mes 23: «en el CSV de reposición, la medida con stock negativo sale dos
// veces» (Tirante Saligna 4.20, −2 en Central y 34 en el Aserradero). La
// medida va una sola vez, arriba, con lo que se trae del Aserradero.
func TestLaMedidaEnNegativoVaUnaVezEnElCsvDeReposicion(t *testing.T) {
	e := armar(t)
	_, tirante := e.catalogo(t)
	e.exec(t, `update inventory set qty = -2, min_qty = 0 where variant_id = $1 and branch_id = $2`, tirante, e.central)
	e.exec(t, `insert into inventory (variant_id, branch_id, qty, min_qty) values ($1, $2, 34, 0)`, tirante, e.aserradero)
	e.pedido(t, "R-9", e.central, "entregado", "mostrador", ahoraDePrueba.Add(-2*24*time.Hour), nil, [4]any{tirante, 2.0, 1.0, nil})
	r, err := e.s.Reposicion(context.Background(), OpcionesDeReposicion{DiasDelPeriodo: 30, CoberturaObjetivo: 30, Sucursal: "todos"})
	if err != nil {
		t.Fatal(err)
	}
	csv := CsvReposicionPorSucursal(r)
	if n := strings.Count(csv, ";TIR;"); n != 1 {
		t.Fatalf("la medida sale %d veces:\n%s", n, csv)
	}
	if lineas := strings.Split(csv, "\r\n"); !strings.Contains(lineas[1], ";TIR;") {
		t.Errorf("la del negativo no va arriba:\n%s", csv)
	}
}

// M2S1-144 (mes 23): el remito sin factura que el cierre avisa va en Cuentas
// a pagar aunque otro movimiento del libro lo tape y la diferencia dé cero.
func TestElRemitoSinFacturaVaEnCuentasAPagar(t *testing.T) {
	e := armar(t)
	prov := e.id(t, `insert into suppliers (nombre) values ('Aserradero El Ombú') returning id`)
	g := e.id(t, `insert into goods_receipts (supplier_id, branch_id, numero_remito, estado, fecha) values ($1, $2, '0002-00034512', 'confirmada', '2026-11-07') returning id`,
		prov, e.central)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto, goods_receipt_id) values ($1, 'factura', 1856355.30, $2)`, prov, g)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto, detalle) values ($1, 'pago', -1856355.30, 'Pago a cuenta')`, prov)
	c, err := e.s.CsvCuentasAPagar(context.Background(), time.Date(2026, 11, 27, 12, 0, 0, 0, Argentina))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c, "Remito 0002-00034512 sin factura") || !strings.Contains(c, "1856355,30") || !strings.Contains(c, "-1856355,30") ||
		!strings.HasSuffix(strings.TrimSpace(c), ";0,00") {
		t.Errorf("cuentas a pagar:\n%s", c)
	}
}
