package reportes

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Fija lo elegido para la comisión en un reintegro por tramos (comité del
// 25/11): el aviso de Mercado Pago no dice cuánto de su comisión devolvió en
// cada tramo, así que los parciales salen del Banco por su importe y la
// comisión queda como gasto. El reintegro entero de una vez sí la revierte
// (TestComisionDeMercadoPagoEnElCierre). Es una pregunta para el contador
// (docs/go/progreso.md, «Para el contador»); si MP lo informa, se guarda en
// payment_refunds y se asienta con ese dato.
func TestComisionEnUnReintegroPorTramos(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre, razon_social) values ('Ana Gómez', 'Gómez SA') returning id`)
	dia := time.Date(2026, 10, 12, 12, 0, 0, 0, Argentina)
	pedido := e.pedido(t, "W-0401", e.central, "entregado", "tienda", dia, &cliente)
	pago := e.id(t, `insert into payments (order_id, customer_id, tipo, proveedor, medio, monto, estado, comision, acreditado_at, created_at, updated_at)
		values ($1, $2, 'pedido', 'mercado_pago', 'visa', 1000, 'reintegrado', 60, $3, $3, $4) returning id`, pedido, cliente, dia, dia.Add(72*time.Hour))
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
		values ('factura_b', 3, 401, 'Gómez SA', 826.45, 173.55, 0, 0, 0, 1000, 'autorizada', $2, '76123456780401', $1)`, pedido, dia)
	e.exec(t, `insert into payment_refunds (payment_id, importe, acumulado, created_at) values
		($1, 400, 400, $2), ($1, 600, 1000, $3)`, pago, dia.Add(24*time.Hour), dia.Add(48*time.Hour))

	p := PeriodoDelCierre("2026-10", ahoraDePrueba)
	todos, err := e.s.AsientosDelPeriodo(ctx, p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	var estos []Asiento
	for _, a := range todos {
		if strings.Contains(a.Concepto, "0003-00000401") && (strings.HasPrefix(a.Concepto, "Cobro ") || strings.HasPrefix(a.Concepto, "Reintegro ")) {
			if !a.Balancea {
				t.Errorf("no cierra: %+v", a)
			}
			estos = append(estos, a)
		}
	}
	if len(estos) != 3 {
		t.Fatalf("el cobro y dos tramos: %+v", estos)
	}
	// Cobró 940 al Banco y devolvió 1000 desde el Banco: −60, la comisión
	// que queda como gasto.
	if b := SaldoDeCuenta(estos, Cuentas.Banco); b != -60 {
		t.Errorf("Banco: %v", b)
	}
	if c := SaldoDeCuenta(estos, Cuentas.Comisiones); c != 60 {
		t.Errorf("Comisiones: %v", c)
	}
	if d := SaldoDeCuenta(estos, Cuentas.Deudores); d != 0 { // el cobro la baja 1000, los tramos la suben 1000
		t.Errorf("Deudores: %v", d)
	}
}
