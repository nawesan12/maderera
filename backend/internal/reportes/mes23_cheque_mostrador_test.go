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
	// Total 668.000 (lo que dice la ficha), todo en 1.1.03: el rechazo
	// asienta la deuda del cheque en Deudores, y las columnas suman el total.
	if !strings.Contains(fila, ";668000,00;18;668000,00;0,00;0,00") {
		t.Errorf("deudores: %q", fila)
	}
	nov := DelCircuito(e.asientosDe(t, "2026-11"), "")
	if n := cuenta(nov, Cuentas.ValoresADepositar); n != 0 {
		t.Errorf("Valores a depositar: %v", n)
	}
	if n := cuenta(nov, Cuentas.Deudores); n != 668000 {
		t.Errorf("Deudores: %v", n)
	}
	adm := e.staff(t, "admin@prueba.test", "admin")
	_, pend, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-11")
	if strings.Contains(pend, "negativo") {
		t.Errorf("el cierre marca algo en negativo: %s", pend)
	}
}
