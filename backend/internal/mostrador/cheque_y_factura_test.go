package mostrador

import (
	"context"
	"strings"
	"testing"
	"time"

	"mjbj/internal/caja"
	"mjbj/internal/facturacion"
	"mjbj/internal/reportes"
	"mjbj/internal/ventas"
)

// El cheque del mostrador es blanco recién cuando sale la factura
// (fragmentos.CircuitoDelCheque). Estas pruebas cuidan que esa vuelta no
// reescriba meses ya entregados ni deje valores colgados en el estudio.

// asientosDelMes son los del blanco de un mes («2026-10»).
func (e *entorno) asientosDelMes(t *testing.T, mes string) []reportes.Asiento {
	t.Helper()
	p := reportes.PeriodoDelCierre(mes, time.Date(2026, 10, 15, 12, 0, 0, 0, caja.Argentina))
	a, err := reportes.Nuevo(e.pool, silencio).AsientosDelPeriodo(context.Background(), p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	return reportes.DelCircuito(a, "blanco")
}

func (e *entorno) exec(t *testing.T, q string, args ...any) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), q, args...); err != nil {
		t.Fatal(err)
	}
}

// Venta del 20/10 con cheque, sin factura; el cheque se acredita el 28/10 y
// la factura sale el 5/11. Octubre se entregó sin el depósito (era del B):
// volver a sacarlo da lo mismo. El depósito cae en noviembre, con el cobro.
func TestElChequeAcreditadoAntesDeLaFacturaNoCambiaElMes(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "cheque-tarde@prueba.test", VentaPedida{MedioPago: ventas.Cheque, Lineas: placas(e, 10, 100),
		Pagos: []ventas.PagoDeVenta{{Medio: ventas.Cheque, Importe: 1000, Cheque: chequeDePago("44445555")}}})
	venta := time.Date(2026, 10, 20, 11, 0, 0, 0, caja.Argentina)
	e.exec(t, `UPDATE orders SET created_at = $2, cobrada_at = $2 WHERE id = $1`, c.pedido, venta)
	e.exec(t, `UPDATE payments SET created_at = $2, conciliado_at = $2 WHERE order_id = $1`, c.pedido, venta)
	e.exec(t, `UPDATE invoices SET fecha_emision = $2 WHERE id = $1`, c.factura, time.Date(2026, 11, 5, 10, 0, 0, 0, caja.Argentina))
	e.exec(t, `UPDATE cheques SET estado = 'depositado' WHERE numero = '44445555'`)
	e.exec(t, `UPDATE cheques SET estado = 'acreditado' WHERE numero = '44445555'`)
	e.exec(t, `UPDATE cheque_estados SET at = $1 WHERE cheque_id = (SELECT id FROM cheques WHERE numero = '44445555')`,
		time.Date(2026, 10, 28, 12, 0, 0, 0, caja.Argentina))

	octubre := e.asientosDelMes(t, "2026-10")
	for _, a := range octubre {
		for _, r := range a.Renglones {
			if r.Cuenta == reportes.Cuentas.ValoresADepositar || r.Cuenta == reportes.Cuentas.Banco {
				t.Errorf("octubre cambió: %+v", a)
			}
		}
	}
	noviembre := e.asientosDelMes(t, "2026-11")
	if s := reportes.SaldoDeCuenta(noviembre, reportes.Cuentas.ValoresADepositar); !cerca(s, 0) {
		t.Errorf("Valores a depositar de noviembre: %v (cobro y depósito juntos)", s)
	}
	if s := reportes.SaldoDeCuenta(noviembre, reportes.Cuentas.Banco); !cerca(s, 1000) {
		t.Errorf("Banco de noviembre: %v", s)
	}
}

// El cheque rebotó y su nota de débito le cargó los 1000 al cliente: lo
// que devuelve de la mercadería vuelve a la cuenta (nota de crédito contra
// esa deuda), y no queda sin destino.
func TestConElChequeRebotadoSeDevuelveALaCuenta(t *testing.T) {
	e := armar(t)
	cliente := e.cliente
	c := e.vendidaYFacturada(t, "rebotado-cuenta@prueba.test", VentaPedida{MedioPago: ventas.Cheque, CustomerID: &cliente, ContactoNombre: "Ana Gómez",
		Lineas: placas(e, 10, 100), Pagos: []ventas.PagoDeVenta{{Medio: ventas.Cheque, Importe: 1000, Cheque: chequeDePago("55556666")}}})
	e.exec(t, `UPDATE cheques SET estado = 'rechazado' WHERE numero = '55556666'`)
	e.exec(t, `INSERT INTO account_movements (customer_id, tipo, monto, detalle, cheque_id)
		SELECT $1, 'nota_debito', 1000, 'Cheque rechazado', id FROM cheques WHERE numero = '55556666'`, cliente)
	saldoAntes := e.num(t, `select coalesce(sum(monto), 0)::float8 from account_movements where customer_id = $1`, cliente)

	datos, err := c.fac.ParaDevolver(context.Background(), c.factura)
	if err != nil {
		t.Fatal(err)
	}
	if datos.Afuera != 0 || datos.Cuenta != 1000 {
		t.Fatalf("topes: afuera %v, cuenta %v", datos.Afuera, datos.Cuenta)
	}
	d, err := c.devolver(4, facturacion.DevolverPorCuenta)
	if err != nil {
		t.Fatal(err)
	}
	if d.Importe != 400 {
		t.Errorf("nota de crédito por %v", d.Importe)
	}
	if s := e.num(t, `select coalesce(sum(monto), 0)::float8 from account_movements where customer_id = $1`, cliente); !cerca(s, saldoAntes-400) {
		t.Errorf("saldo de la cuenta %v, quería %v", s, saldoAntes-400)
	}
	if n := e.num(t, `select count(*)::float8 from payment_refunds t join payments p on p.id = t.payment_id where p.order_id = $1`, c.pedido); n != 0 {
		t.Errorf("la devolución a la cuenta dejó %v tramos", n)
	}
}

// Dos cheques, el de 400 rebotado: la devolución por afuera anota su tramo
// en el cobro del cheque vivo (el de 600), no en el del que nunca se cobró.
func TestElTramoNoCaeEnElChequeRechazado(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "dos-cheques@prueba.test", VentaPedida{MedioPago: ventas.Cheque, Lineas: placas(e, 10, 100),
		Pagos: []ventas.PagoDeVenta{{Medio: ventas.Cheque, Importe: 400, Cheque: chequeDePago("11110000")},
			{Medio: ventas.Cheque, Importe: 600, Cheque: chequeDePago("22220000")}}})
	e.exec(t, `UPDATE cheques SET estado = 'rechazado' WHERE numero = '11110000'`)
	d := c.afuera(t, 5)
	if m := e.num(t, `select p.monto::float8 from payment_refunds t join payments p on p.id = t.payment_id where t.devolucion_id = $1`, d.ID); m != 600 {
		t.Errorf("el tramo cayó en el cobro de %v", m)
	}
}

// El cheque de la venta ya salió en un pago del B: la factura no se emite
// (con ella el cheque pasaba al blanco y Valores a depositar del estudio
// quedaba debitado para siempre). Anulado el pago, se factura.
func TestNoSeFacturaConElChequeEndosadoEnElB(t *testing.T) {
	e := armar(t)
	c := e.vendidaSinFactura(t, "endoso-b@prueba.test", VentaPedida{MedioPago: ventas.Cheque, Lineas: placas(e, 10, 100),
		Pagos: []ventas.PagoDeVenta{{Medio: ventas.Cheque, Importe: 1000, Cheque: chequeDePago("33334444")}}})
	proveedor := e.txt(t, `insert into suppliers (nombre) values ('Aserradero B') returning id::text`)
	pago := e.txt(t, `insert into supplier_payments (supplier_id, total, neto, medio, circuito) values ($1, 1000, 1000, 'cheque', 'negro') returning id::text`, proveedor)
	e.exec(t, `insert into supplier_payment_parts (payment_id, medio, importe, cheque_id) select $1, 'cheque', 1000, id from cheques where numero = '33334444'`, pago)
	e.exec(t, `UPDATE cheques SET estado = 'entregado' WHERE numero = '33334444'`)

	res, err := c.facturar(t)
	if err != nil {
		t.Fatal(err)
	}
	if res.InvoiceID != nil || !strings.Contains(res.Aviso, "circuito B") {
		t.Fatalf("se facturó con el cheque en el B: %+v", res)
	}
	e.exec(t, `UPDATE supplier_payments SET anulado_at = now() WHERE id = $1`, pago)
	if res, err := c.facturar(t); err != nil || res.InvoiceID == nil {
		t.Fatalf("con el pago anulado: %v %+v", err, res)
	}
}

// La devolución por afuera del 31/10 a la noche cuya nota de crédito ARCA
// autoriza el 1/11: el reintegro va a noviembre, con la nota. En octubre
// dejaba Deudores debitado por lo devuelto.
func TestElReintegroVaConLaNotaDeCredito(t *testing.T) {
	e := armar(t)
	venta := time.Date(2026, 10, 31, 15, 0, 0, 0, caja.Argentina)
	c := e.vendidaYFacturada(t, "nota-tarde@prueba.test", VentaPedida{MedioPago: ventas.Debito, Lineas: placas(e, 10, 100)})
	e.exec(t, `UPDATE orders SET created_at = $2, cobrada_at = $2 WHERE id = $1`, c.pedido, venta)
	e.exec(t, `UPDATE payments SET created_at = $2, conciliado_at = $2 WHERE order_id = $1`, c.pedido, venta)
	e.exec(t, `UPDATE invoices SET fecha_emision = $2 WHERE order_id = $1`, c.pedido, venta)
	d := c.afuera(t, 2)
	e.exec(t, `UPDATE payment_refunds SET created_at = $2 WHERE devolucion_id = $1`, d.ID, time.Date(2026, 10, 31, 23, 30, 0, 0, caja.Argentina))
	e.exec(t, `UPDATE invoices SET fecha_emision = $2 WHERE id = $1`, d.NotaID, time.Date(2026, 11, 1, 10, 0, 0, 0, caja.Argentina))
	if r := reintegros(e.asientosDelMes(t, "2026-10")); r[reportes.Cuentas.TarjetasAAcreditar] != 0 {
		t.Errorf("octubre tiene reintegros: %v", r)
	}
	if s := reportes.SaldoDeCuenta(e.asientosDelMes(t, "2026-10"), reportes.Cuentas.Deudores); !cerca(s, 0) {
		t.Errorf("Deudores de octubre: %v", s)
	}
	if r := reintegros(e.asientosDelMes(t, "2026-11")); !cerca(r[reportes.Cuentas.TarjetasAAcreditar], 200) {
		t.Errorf("noviembre: %v", r)
	}
}
