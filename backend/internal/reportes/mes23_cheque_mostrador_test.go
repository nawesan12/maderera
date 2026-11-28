package reportes

import (
	"context"
	"strings"
	"testing"
	"time"
)

// M2S3-005: el cheque de una venta del mostrador con Factura A sin CAE
// rebota y la deuda vuelve a la cuenta con una nota de débito. El listado de
// deudores tiene que mostrar al cliente con lo que debe, y el cierre no
// puede marcarlo con Deudores en negativo por la retención que le hicieron
// ni dejar Valores a depositar en negativo.
func TestElChequeRechazadoDeUnaVentaConFacturaSinCae(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Techos Costa') returning id`)
	pedido := e.id(t, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, estado_pago, total, customer_id, created_at)
		values ('PED-1103', 'Techos', $1, 'mostrador', 'entregado', 'pagado', 676000, $2, '2026-11-10T15:00:00Z') returning id`, e.central, cli)
	pago := e.id(t, `insert into order_payments (order_id, medio, importe, created_at) values ($1, 'cheque', 676000, '2026-11-10T15:00:00Z') returning id`, pedido)
	e.exec(t, `insert into payments (order_id, customer_id, tipo, proveedor, medio, monto, estado, conciliado_at, created_at)
		values ($1, $2, 'pedido', 'mostrador', 'cheque', 676000, 'aprobado', '2026-11-10T15:00:00Z', '2026-11-10T15:00:00Z')`, pedido, cli)
	e.facturaSinCae(t, &cli, &pedido, 32, 676000, "2026-11-10T15:00:00Z")
	ch := e.id(t, `insert into cheques (sentido, tipo, numero, fecha_pago, importe, estado, circuito, order_payment_id, customer_id)
		values ('recibido', 'fisico', '00088123', '2026-11-11', 676000, 'cartera', 'blanco', $1, $2) returning id`, pago, cli)
	e.exec(t, `update cheques set estado = 'rechazado' where id = $1`, ch)
	e.exec(t, `update cheque_estados set at = '2026-11-12T15:00:00Z' where cheque_id = $1`, ch)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, cheque_id, created_at) values ($1, 'nota_debito', 676000, $2, '2026-11-12T15:00:00Z')`, cli, ch)
	e.recibir(t, &cli, "REC-0030", "2026-11-13T15:00:00Z", [2]any{"retencion", 8000.0})
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'pago', -8000, '2026-11-13T15:00:00Z')`, cli)

	d, err := e.s.CsvDeudores(context.Background(), time.Date(2026, 11, 30, 12, 0, 0, 0, Argentina))
	if err != nil {
		t.Fatal(err)
	}
	var fila string
	for _, l := range strings.Split(d, "\n") {
		if strings.Contains(l, "Techos Costa") {
			fila = l
		}
	}
	// Total 668.000 (lo que dice la ficha), todo sin CAE: el rechazo da
	// vuelta el cobro que esperaba en Anticipos, y la deuda es la de la
	// factura que espera el CAE (M2S3-005). Antes iba a «Con CAE (1.1.03)».
	if !strings.Contains(fila, ";668000,00;18;0,00;0,00;0,00;668000,00") {
		t.Errorf("deudores: %q", fila)
	}
	nov := DelCircuito(e.asientosDe(t, "2026-11"), "")
	if n := cuenta(nov, Cuentas.ValoresADepositar); n != 0 {
		t.Errorf("Valores a depositar: %v", n)
	}
	if n := cuenta(nov, Cuentas.Deudores); n != 0 {
		t.Errorf("Deudores: %v", n)
	}
	// En Anticipos queda solo la retención: el cheque rebotado no es un pago.
	if n := cuenta(nov, Cuentas.AnticiposDeClientes); n != -8000 {
		t.Errorf("Anticipos: %v", n)
	}
	adm := e.staff(t, "admin@prueba.test", "admin")
	_, pend, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-11")
	if strings.Contains(pend, "negativo") {
		t.Errorf("el cierre marca algo en negativo: %s", pend)
	}
}

// M2S3-005 (mes 23): PED-1160, Factura A sin CAE cobrada con el cheque
// 00088123 de 118.500. El cobro entra a Valores contra Anticipos; el rechazo
// tiene que salir de Anticipos (antes debitaba Deudores: Anticipos quedaba
// inflado y el deudor contado dos veces). Cuando llega el CAE, la deuda
// queda en Deudores una sola vez y Anticipos en cero.
func TestElRechazoAntesDelCaeSaleDeAnticipos(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Constructora del Sur') returning id`)
	pedido := e.id(t, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, estado_pago, total, customer_id, created_at)
		values ('PED-1160', 'Constructora', $1, 'mostrador', 'entregado', 'pagado', 118500, $2, '2026-11-10T15:00:00Z') returning id`, e.central, cli)
	pago := e.id(t, `insert into order_payments (order_id, medio, importe, created_at) values ($1, 'cheque', 118500, '2026-11-10T15:00:00Z') returning id`, pedido)
	e.exec(t, `insert into payments (order_id, customer_id, tipo, proveedor, medio, monto, estado, conciliado_at, created_at)
		values ($1, $2, 'pedido', 'mostrador', 'cheque', 118500, 'aprobado', '2026-11-10T15:00:00Z', '2026-11-10T15:00:00Z')`, pedido, cli)
	factura := e.facturaSinCae(t, &cli, &pedido, 60, 118500, "2026-11-10T15:00:00Z")
	ch := e.id(t, `insert into cheques (sentido, tipo, numero, fecha_pago, importe, estado, circuito, order_payment_id, customer_id)
		values ('recibido', 'fisico', '00088123', '2026-11-11', 118500, 'cartera', 'blanco', $1, $2) returning id`, pago, cli)
	e.exec(t, `update cheques set estado = 'rechazado' where id = $1`, ch)
	e.exec(t, `update cheque_estados set at = '2026-11-12T15:00:00Z' where cheque_id = $1`, ch)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, cheque_id, created_at) values ($1, 'nota_debito', 118500, $2, '2026-11-12T15:00:00Z')`, cli, ch)

	nov := DelCircuito(e.asientosDe(t, "2026-11"), "")
	if n := cuenta(nov, Cuentas.AnticiposDeClientes); n != 0 {
		t.Errorf("Anticipos después del rechazo: %v", n)
	}
	if n := cuenta(nov, Cuentas.Deudores); n != 0 {
		t.Errorf("Deudores después del rechazo: %v", n)
	}
	if n := cuenta(nov, Cuentas.ValoresADepositar); n != 0 {
		t.Errorf("Valores a depositar: %v", n)
	}
	fila := func(cuando time.Time) string {
		d, err := e.s.CsvDeudores(context.Background(), cuando)
		if err != nil {
			t.Fatal(err)
		}
		for _, l := range strings.Split(d, "\n") {
			if strings.Contains(l, "Constructora del Sur") {
				return l
			}
		}
		return ""
	}
	// Con CAE 0, sin CAE 118.500.
	if f := fila(time.Date(2026, 11, 20, 12, 0, 0, 0, Argentina)); !strings.HasSuffix(strings.TrimSpace(f), ";0,00;0,00;118500,00") {
		t.Errorf("deudores antes del CAE: %q", f)
	}

	// Llega el CAE el 20/11: la venta va a Deudores y no hay anticipo que imputar.
	e.exec(t, `update invoices set cae = '7612', estado = 'autorizada', fecha_emision = '2026-11-20T15:00:00Z' where id = $1`, factura)
	nov = DelCircuito(e.asientosDe(t, "2026-11"), "")
	if n := cuenta(nov, Cuentas.AnticiposDeClientes); n != 0 {
		t.Errorf("Anticipos con el CAE: %v", n)
	}
	if n := cuenta(nov, Cuentas.Deudores); n != 118500 {
		t.Errorf("Deudores con el CAE: %v", n)
	}
	if f := fila(time.Date(2026, 11, 25, 12, 0, 0, 0, Argentina)); !strings.HasSuffix(strings.TrimSpace(f), ";118500,00;0,00;0,00;0,00") {
		t.Errorf("deudores con el CAE: %q", f)
	}
}
