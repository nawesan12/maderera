package reportes

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
)

// M3S3-005: la deuda es un pedido entregado sin facturar; se cobra con un
// cheque (el reparto lo manda entero al B) y el pedido se factura después.
// El cheque entra y sale de Valores a depositar en el mismo archivo, se
// acredite antes o después de la factura, y la venta facturada no queda
// además como venta sin factura en el B.
func TestChequeDeUnPedidoQueSeFacturaDespues(t *testing.T) {
	for _, caso := range []struct {
		nombre                string
		acreditado, facturado string
	}{
		{"acreditado antes de la factura", "2026-10-06T15:00:00Z", "2026-10-08T15:00:00Z"},
		{"acreditado después de la factura", "2026-10-10T15:00:00Z", "2026-10-08T15:00:00Z"},
	} {
		t.Run(caso.nombre, func(t *testing.T) {
			e := armar(t)
			ctx := context.Background()
			andes := e.id(t, `insert into customers (nombre) values ('Los Andes') returning id`)
			pedido := e.pedido(t, "PED-1329", e.central, "entregado", "mostrador", time.Date(2026, 10, 3, 12, 0, 0, 0, Argentina), &andes)
			e.exec(t, `update orders set total = 68800, medio_pago = 'cuenta_corriente' where id = $1`, pedido)
			e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at)
				values ($1, 'compra', 68800, 'PED-1329', '2026-10-03T15:00:00Z')`, andes)
			e.exec(t, `insert into order_status_history (order_id, estado, created_at) values ($1, 'entregado', '2026-10-03T15:00:00Z')`, pedido)

			recibo := e.id(t, `insert into receipts (numero, customer_id, recibido_de, total, origen, created_at)
				values ('REC-0096', $1, 'Los Andes', 68800, 'panel', '2026-10-04T15:00:00Z') returning id`, andes)
			cheque := e.id(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id, receipt_id)
				values ('recibido', '00104001', 'Nación', '2026-10-04', 68800, 'cartera', $1, $2) returning id`, andes, recibo)
			e.exec(t, `insert into receipt_parts (receipt_id, medio, importe, orden, cheque_id) values ($1, 'cheque', 68800, 0, $2)`, recibo, cheque)
			e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at)
				values ($1, 'pago', -68800, 'REC-0096', '2026-10-04T15:00:00Z')`, andes)
			var rep cobros.Reparto
			if err := pgx.BeginFunc(ctx, e.pool, func(tx pgx.Tx) error {
				var err error
				rep, err = cobros.FijarReparto(ctx, tx, recibo)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			if rep.B != 68800 {
				t.Fatalf("el cobro de una venta sin factura va al B: %+v", rep)
			}
			e.exec(t, `update cheques set estado = 'depositado' where id = $1`, cheque)
			e.exec(t, `update cheque_estados set at = '2026-10-05T15:00:00Z' where cheque_id = $1 and hacia = 'depositado'`, cheque)
			e.exec(t, `update cheques set estado = 'acreditado' where id = $1`, cheque)
			e.exec(t, `update cheque_estados set at = $2 where cheque_id = $1 and hacia = 'acreditado'`, cheque, caso.acreditado)
			e.facturaConCae(t, &andes, 116, 68800, caso.facturado, &pedido)

			octubre := e.asientosDe(t, "2026-10")
			b, blanco := DelCircuito(octubre, CircuitoNegro), DelCircuito(octubre, "")
			detalle := func() string {
				s := ""
				for _, a := range octubre {
					s += fmt.Sprintf("\n  [%s] %s %+v", a.circuito(), a.Concepto, a.Renglones)
				}
				return s
			}
			if v := cuenta(b, Cuentas.ValoresADepositar); v != 0 {
				t.Errorf("Valores a depositar del B: %v%s", v, detalle())
			}
			if v := cuenta(blanco, Cuentas.ValoresADepositar); v != 0 {
				t.Errorf("Valores a depositar del estudio: %v%s", v, detalle())
			}
			if v := cuenta(b, Cuentas.VentasSinFactura); v != 0 {
				t.Errorf("la venta facturada sigue como venta sin factura en el B: %v%s", v, detalle())
			}
			if v := cuenta(b, Cuentas.Banco); v != 0 {
				t.Errorf("Banco del B: %v%s", v, detalle())
			}
			if v := cuenta(blanco, Cuentas.Banco); v != 68800 {
				t.Errorf("Banco del estudio: %v%s", v, detalle())
			}
			if v := cuenta(blanco, Cuentas.Deudores); v != 0 {
				t.Errorf("Deudores del estudio con la factura cobrada: %v%s", v, detalle())
			}
		})
	}
}
