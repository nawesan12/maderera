package reportes

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Mes 23: en el CSV de deudores, V2 Constructora (toda su deuda era de una
// A sin CAE) salía con parte de la deuda en la columna del circuito B. Una
// A sin CAE de un pedido a cuenta corriente, cobrada en parte: lo que queda
// va entero a «Facturas sin CAE», nada al B.
func TestLaDeudaDeUnaASinCaeNoVaAlB(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('V2 Constructora') returning id`)
	pedido := e.id(t, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, estado_pago, medio_pago, total, customer_id, created_at, vendido_at)
		values ('PED-1200', 'V2', $1, 'mostrador', 'entregado', 'pendiente', 'cuenta_corriente', 363000, $2, '2026-11-10T15:00:00Z', '2026-11-10T15:00:00Z') returning id`, e.central, cli)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at) values ($1, 'compra', 363000, 'PED-1200', '2026-11-10T15:00:00Z')`, cli)
	e.facturaSinCae(t, &cli, &pedido, 70, 363000, "2026-11-10T15:00:00Z")
	e.reciboDe(t, &cli, nil, "REC-0070", "2026-11-12T15:00:00Z", [2]any{"transferencia", 179345.0})
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'pago', -179345, '2026-11-12T15:00:00Z')`, cli)

	d, err := e.s.CsvDeudores(context.Background(), time.Date(2026, 11, 30, 12, 0, 0, 0, Argentina))
	if err != nil {
		t.Fatal(err)
	}
	var fila string
	for _, l := range strings.Split(d, "\n") {
		if strings.Contains(l, "V2 Constructora") {
			fila = l
		}
	}
	if !strings.HasSuffix(strings.TrimSpace(fila), ";0,00;183655,00;0,00;0,00;0,00") {
		t.Errorf("deudores: %q", fila)
	}
}

// El cobro entró antes de la factura (el pedido ya entregado).
func TestLaDeudaDeUnaASinCaeCobradaAntesNoVaAlB(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('V2 Constructora') returning id`)
	pedido := e.id(t, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, estado_pago, medio_pago, total, customer_id, created_at, vendido_at)
		values ('PED-1200', 'V2', $1, 'mostrador', 'entregado', 'pendiente', 'cuenta_corriente', 363000, $2, '2026-11-10T15:00:00Z', '2026-11-10T15:00:00Z') returning id`, e.central, cli)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at) values ($1, 'compra', 363000, 'PED-1200', '2026-11-10T15:00:00Z')`, cli)
	e.reciboDe(t, &cli, nil, "REC-0070", "2026-11-11T15:00:00Z", [2]any{"transferencia", 179345.0})
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'pago', -179345, '2026-11-11T15:00:00Z')`, cli)
	e.facturaSinCae(t, &cli, &pedido, 70, 363000, "2026-11-12T15:00:00Z")

	d, err := e.s.CsvDeudores(context.Background(), time.Date(2026, 11, 30, 12, 0, 0, 0, Argentina))
	if err != nil {
		t.Fatal(err)
	}
	var fila string
	for _, l := range strings.Split(d, "\n") {
		if strings.Contains(l, "V2 Constructora") {
			fila = l
		}
	}
	if !strings.HasSuffix(strings.TrimSpace(fila), ";0,00;183655,00;0,00;0,00;0,00") {
		t.Errorf("deudores: %q", fila)
	}
}
