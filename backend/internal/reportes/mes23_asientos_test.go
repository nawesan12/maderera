package reportes

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
)

// Los asientos que el mes simulado (tanda 23) encontró mal: cada cobro va al
// archivo de su venta, el cheque por el archivo por el que entró y el costo
// con la venta.

// refijar vuelve a fijar el reparto de un recibo, como cobrarConRecibo
// después de atarlo a la factura que cobra.
func (e *entorno) refijar(t *testing.T, recibo string) cobros.Reparto {
	t.Helper()
	var rep cobros.Reparto
	if err := pgx.BeginFunc(context.Background(), e.pool, func(tx pgx.Tx) error {
		var err error
		rep, err = cobros.FijarReparto(context.Background(), tx, recibo)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return rep
}

func (e *entorno) facturaSinCae(t *testing.T, cliente, pedido *string, numero int, total float64, cuando string) string {
	t.Helper()
	neto := redondear(total / 1.21)
	return e.id(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado,
		fecha_emision, created_at, customer_id, order_id) values ('factura_a', 15, $1, 'Cliente', $2, $3, 0, 0, 0, $4, 'emitida', $5, $5, $6, $7) returning id`,
		numero, neto, redondear(total-neto), total, cuando, cliente, pedido)
}

// M2S4-002: el cobro que se imputa a una factura sin CAE va entero a
// Anticipos de esa factura, aunque el cliente deba otra cosa en Deudores (la
// nota de débito de un cheque rechazado). Antes cancelaba esa deuda primero.
func TestElCobroDeUnaFacturaSinCaeVaASusAnticipos(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Constructora') returning id`)
	// Una factura con CAE que se cobró con un cheque que rebotó: Deudores
	// queda con 100.000 abiertos.
	e.facturaConCae(t, &cli, 40, 100000, "2026-11-02T15:00:00Z", nil)
	e.recibir(t, &cli, "R-1", "2026-11-03T15:00:00Z", [2]any{"transferencia", 100000.0})
	ch := e.id(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id) values ('recibido', '45001', 'Nación', '2026-11-04', 100000, 'cartera', $1) returning id`, cli)
	e.exec(t, `update cheques set estado = 'rechazado' where id = $1`, ch)
	e.exec(t, `update cheque_estados set at = '2026-11-05T15:00:00Z' where cheque_id = $1`, ch)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, cheque_id, created_at) values ($1, 'nota_debito', 100000, $2, '2026-11-05T15:00:00Z')`, cli, ch)

	// La A 0064 sin CAE, cobrada en parte desde Facturación.
	factura := e.facturaSinCae(t, &cli, nil, 64, 486000, "2026-11-10T15:00:00Z")
	r, _ := e.reciboDe(t, &cli, nil, "REC-0053", "2026-11-11T15:00:00Z", [2]any{"transferencia", 186000.0})
	e.exec(t, `insert into invoice_payments (invoice_id, medio, monto, receipt_id, fecha) values ($1, 'transferencia', 186000, $2, '2026-11-11T15:00:00Z')`, factura, r)
	rep := e.refijar(t, r)
	if rep.Anticipo != 186000 || rep.Deudores != 0 || rep.B != 0 {
		t.Fatalf("el cobro de la factura sin CAE: %+v", rep)
	}
	nov := DelCircuito(e.asientosDe(t, "2026-11"), "")
	if x := buscarAsiento(nov, "Recibo REC-0053"); x == nil || cuenta([]Asiento{*x}, Cuentas.AnticiposDeClientes) != -186000 ||
		cuenta([]Asiento{*x}, Cuentas.Deudores) != 0 {
		t.Errorf("el asiento del recibo: %+v", x)
	}
	// Llega el CAE: el anticipo se le aplica a esa factura.
	e.exec(t, `update invoices set cae = '761', estado = 'autorizada', fecha_emision = '2026-11-20T15:00:00Z' where id = $1`, factura)
	nov = DelCircuito(e.asientosDe(t, "2026-11"), "")
	if n := cuenta(nov, Cuentas.AnticiposDeClientes); n != 0 {
		t.Errorf("Anticipos con el CAE: %v", n)
	}
	// Deudores: los 100.000 del cheque y los 300.000 que faltan de la A 0064.
	if n := cuenta(nov, Cuentas.Deudores); n != 400000 {
		t.Errorf("Deudores: %v", n)
	}
}

// M3S1-001 y M3S1-004: el cheque que entró con un recibo que fue a
// Anticipos rebota: el rechazo sale de Anticipos, no de Deudores. Antes los
// 500.000 quedaban en los dos.
func TestElRechazoSaleDeAnticipos(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Constructora') returning id`)
	e.facturaSinCae(t, &cli, nil, 70, 500000, "2026-11-10T15:00:00Z")
	r, rep := e.reciboDe(t, &cli, nil, "REC-0064", "2026-11-11T15:00:00Z", [2]any{"cheque", 500000.0})
	if rep.Anticipo != 500000 {
		t.Fatalf("el recibo es seña de la factura sin CAE: %+v", rep)
	}
	ch := e.id(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id, receipt_id) values ('recibido', '93001', 'Ciudad', '2026-11-12', 500000, 'cartera', $1, $2) returning id`, cli, r)
	e.exec(t, `update receipt_parts set cheque_id = $1 where receipt_id = $2`, ch, r)
	e.refijar(t, r)
	e.exec(t, `update cheques set estado = 'rechazado' where id = $1`, ch)
	e.exec(t, `update cheque_estados set at = '2026-11-13T15:00:00Z' where cheque_id = $1`, ch)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, cheque_id, created_at) values ($1, 'nota_debito', 500000, $2, '2026-11-13T15:00:00Z')`, cli, ch)

	nov := DelCircuito(e.asientosDe(t, "2026-11"), "")
	if x := buscarAsiento(nov, "Cheque N° 93001 · Ciudad rechazado"); x == nil || cuenta([]Asiento{*x}, Cuentas.AnticiposDeClientes) != 500000 ||
		cuenta([]Asiento{*x}, Cuentas.Deudores) != 0 {
		t.Errorf("el rechazo: %+v", x)
	}
	if n := cuenta(nov, Cuentas.AnticiposDeClientes); n != 0 {
		t.Errorf("Anticipos queda con el cheque que no se cobró: %v", n)
	}
	if n := cuenta(nov, Cuentas.Deudores); n != 0 {
		t.Errorf("Deudores sube por una deuda que espera el CAE: %v", n)
	}
	if n := cuenta(nov, Cuentas.ValoresADepositar); n != 0 {
		t.Errorf("Valores a depositar: %v", n)
	}
}

// M3S3-001: el recibo que fue entero al B se lleva su cheque: la
// acreditación va al B, el cheque queda marcado del B y el archivo del
// estudio no tiene Valores a depositar negativo.
func TestElChequeDelReciboBVaPorElB(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Herrería') returning id`)
	r, rep := e.reciboDe(t, &cli, nil, "REC-0096", "2026-11-11T15:00:00Z", [2]any{"cheque", 68800.0})
	if rep.B != 68800 {
		t.Fatalf("sin nada facturado va al B: %+v", rep)
	}
	ch := e.id(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id, receipt_id) values ('recibido', '104001', 'Nación', '2026-11-12', 68800, 'cartera', $1, $2) returning id`, cli, r)
	e.exec(t, `update receipt_parts set cheque_id = $1 where receipt_id = $2`, ch, r)
	e.refijar(t, r)
	var marca string
	if err := e.pool.QueryRow(context.Background(), `select coalesce(circuito_reparto, '') from cheques where id = $1`, ch).Scan(&marca); err != nil || marca != "negro" {
		t.Fatalf("el cheque queda del B: %q %v", marca, err)
	}
	e.exec(t, `update cheques set estado = 'depositado' where id = $1`, ch)
	e.exec(t, `update cheques set estado = 'acreditado' where id = $1`, ch)
	e.exec(t, `update cheque_estados set at = '2026-11-14T15:00:00Z' where cheque_id = $1`, ch)
	a := e.asientosDe(t, "2026-11")
	if n := cuenta(DelCircuito(a, ""), Cuentas.ValoresADepositar); n != 0 {
		t.Errorf("Valores a depositar del estudio: %v", n)
	}
	if n := cuenta(DelCircuito(a, CircuitoNegro), Cuentas.ValoresADepositar); n != 0 {
		t.Errorf("Valores a depositar del B: %v", n)
	}
	if n := cuenta(DelCircuito(a, CircuitoNegro), Cuentas.Banco); n != 68800 {
		t.Errorf("el banco del B: %v", n)
	}
}

// M2S1-012: el cheque de un recibo que fue al B rebota en el B: el archivo
// del estudio no debita Deudores ni acredita unos Valores a depositar que
// nunca tuvo, y en el B no quedan Valores a depositar colgados.
func TestElRechazoDelChequeDelBVaPorElB(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Constructora del Sur') returning id`)
	r, rep := e.reciboDe(t, &cli, nil, "REC-0005", "2026-11-11T15:00:00Z", [2]any{"echeq", 300000.0})
	if rep.B != 300000 {
		t.Fatalf("sin nada facturado va al B: %+v", rep)
	}
	ch := e.id(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id, receipt_id) values ('recibido', '00098765', 'Galicia', '2026-11-12', 300000, 'cartera', $1, $2) returning id`, cli, r)
	e.exec(t, `update receipt_parts set cheque_id = $1 where receipt_id = $2`, ch, r)
	e.refijar(t, r)
	e.exec(t, `update cheques set estado = 'rechazado' where id = $1`, ch)
	e.exec(t, `update cheque_estados set at = '2026-11-13T15:00:00Z' where cheque_id = $1`, ch)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, cheque_id, created_at) values ($1, 'nota_debito', 300000, $2, '2026-11-13T15:00:00Z')`, cli, ch)
	a := e.asientosDe(t, "2026-11")
	blanco, negro := DelCircuito(a, ""), DelCircuito(a, CircuitoNegro)
	if n := cuenta(blanco, Cuentas.ValoresADepositar); n != 0 {
		t.Errorf("Valores a depositar del estudio: %v", n)
	}
	if n := cuenta(blanco, Cuentas.Deudores); n != 0 {
		t.Errorf("Deudores del estudio sin factura que lo respalde: %v", n)
	}
	if n := cuenta(negro, Cuentas.ValoresADepositar); n != 0 {
		t.Errorf("Valores a depositar colgados en el B: %v", n)
	}
}

// M2S2-006: el cobro de la conciliación que fue al B pasa al archivo del
// estudio el día que se emite la factura, aunque espere el CAE, y se imputa
// a Deudores cuando llega.
func TestElCobroDelBPasaAlFacturar(t *testing.T) {
	e := armar(t)
	placa, _ := e.catalogo(t)
	pedido := e.pedido(t, "PED-1051", e.central, "entregado", "tienda", time.Date(2026, 11, 10, 12, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 490500.0, 0.0})
	e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, created_at, acreditado_at)
		values ($1, 'pedido', 'transferencia', 'transferencia', 490500, 'aprobado', '2026-11-11T15:00:00Z', '2026-11-11T15:00:00Z')`, pedido)
	factura := e.facturaSinCae(t, nil, &pedido, 9, 490500, "2026-11-12T15:00:00Z")
	a := e.asientosDe(t, "2026-11")
	b, blanco := DelCircuito(a, CircuitoNegro), DelCircuito(a, "")
	if n := cuenta(b, Cuentas.VentasSinFactura); n != 0 {
		t.Errorf("la venta no queda en el B: %v", n)
	}
	if n := cuenta(b, Cuentas.Banco); n != 0 {
		t.Errorf("el banco del B: %v", n)
	}
	if n := cuenta(blanco, Cuentas.Banco); n != 490500 {
		t.Errorf("el banco del estudio: %v", n)
	}
	if n := cuenta(blanco, Cuentas.AnticiposDeClientes); n != -490500 {
		t.Errorf("espera el CAE en Anticipos: %v", n)
	}
	e.exec(t, `update invoices set cae = '761', estado = 'autorizada', fecha_emision = '2026-11-20T15:00:00Z' where id = $1`, factura)
	blanco = DelCircuito(e.asientosDe(t, "2026-11"), "")
	if n := cuenta(blanco, Cuentas.AnticiposDeClientes); n != 0 {
		t.Errorf("con el CAE se imputa: %v", n)
	}
	if n := cuenta(blanco, Cuentas.Deudores); n != 0 {
		t.Errorf("Deudores cierra: %v", n)
	}
}

// M2S2-011: el cobro a cuenta de un pedido entregado a cuenta corriente,
// que fue al B, pasa al estudio cuando el pedido se factura: hasta lo que la
// cuenta dice pagado.
func TestElCobroACuentaPasaAlFacturar(t *testing.T) {
	e := armar(t)
	placa, _ := e.catalogo(t)
	cli := e.id(t, `insert into customers (nombre) values ('Taller Bosque') returning id`)
	pedido := e.pedido(t, "PED-1056", e.central, "entregado", "mostrador", time.Date(2026, 11, 10, 12, 0, 0, 0, Argentina), &cli, [4]any{placa, 1.0, 387900.0, 0.0})
	e.exec(t, `update orders set medio_pago = 'cuenta_corriente' where id = $1`, pedido)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at) values ($1, 'compra', 387900, 'PED-1056', '2026-11-10T15:00:00Z')`, cli)
	_, rep := e.reciboDe(t, &cli, nil, "REC-0019", "2026-11-11T15:00:00Z", [2]any{"efectivo", 437900.0})
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'pago', -437900, '2026-11-11T15:00:00Z')`, cli)
	if rep.B != 437900 {
		t.Fatalf("entregado y sin factura, al B: %+v", rep)
	}
	e.facturaSinCae(t, &cli, &pedido, 27, 387900, "2026-11-12T15:00:00Z")
	blanco := DelCircuito(e.asientosDe(t, "2026-11"), "")
	if x := buscarAsiento(blanco, "Recibo REC-0019 · Factura A 0015-00000027"); x == nil || cuenta([]Asiento{*x}, Cuentas.Caja) != 387900 ||
		cuenta([]Asiento{*x}, Cuentas.AnticiposDeClientes) != -387900 {
		t.Errorf("el pase al estudio: %+v", x)
	}
	b := DelCircuito(e.asientosDe(t, "2026-11"), CircuitoNegro)
	if n := cuenta(b, Cuentas.VentasSinFactura); n != -50000 {
		t.Errorf("en el B queda solo lo que sobró: %v", n)
	}
}

// M2S1-060: el costo de la venta facturada espera el CAE, como la venta.
func TestElCostoEsperaElCae(t *testing.T) {
	e := armar(t)
	placa, _ := e.catalogo(t)
	pedido := e.pedido(t, "PED-1003", e.central, "entregado", "mostrador", time.Date(2026, 11, 10, 12, 0, 0, 0, Argentina), nil, [4]any{placa, 1.0, 193000.0, 120000.0})
	e.exec(t, `update orders set comprobante = 'fiscal', facturado_at = '2026-11-10T15:00:00Z' where id = $1`, pedido)
	factura := e.facturaSinCae(t, nil, &pedido, 3, 193000, "2026-11-10T15:00:00Z")
	nov := e.asientosDe(t, "2026-11")
	if n := cuenta(nov, Cuentas.CostoDeVentas); n != 0 {
		t.Errorf("sin CAE, el costo no se asienta: %v", n)
	}
	e.exec(t, `update invoices set cae = '761', estado = 'autorizada', fecha_emision = '2026-12-02T15:00:00Z' where id = $1`, factura)
	if n := cuenta(e.asientosDe(t, "2026-11"), Cuentas.CostoDeVentas); n != 0 {
		t.Errorf("noviembre no cambia: %v", n)
	}
	dic := DelCircuito(e.asientosDe(t, "2026-12"), "")
	if n := cuenta(dic, Cuentas.CostoDeVentas); n != 120000 {
		t.Errorf("el costo va con la venta, en diciembre: %v", n)
	}
	if n := cuenta(dic, Cuentas.Ventas); n >= 0 {
		t.Errorf("y la venta en el mismo archivo: %v", n)
	}
}
