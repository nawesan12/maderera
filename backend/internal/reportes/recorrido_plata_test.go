package reportes

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"mjbj/internal/reglas"
)

// Recorrido M4-094: un cliente sin deuda trae un cheque de $ 40.000 a
// cuenta. No paga ninguna venta, ni blanca ni sin factura: es un anticipo,
// va al archivo del estudio y se aplica a la factura que viene. Antes se
// asentaba en el B contra Ventas sin factura, el cheque quedaba marcado B y
// la venta blanca de después lo volvía a consumir: ingreso dos veces.
func TestElChequeACuentaDeUnClienteSinDeudaEsAnticipo(t *testing.T) {
	e := armar(t)
	wood := e.id(t, `insert into customers (nombre) values ('Wood Frame Costa') returning id`)
	r, rep := e.reciboDe(t, &wood, nil, "REC-0020", "2026-11-03T15:00:00Z", [2]any{"cheque", 40000.0})
	if rep.Anticipo != 40000 || rep.B != 0 || rep.Deudores != 0 {
		t.Fatalf("el cheque a cuenta sin deuda es anticipo: %+v", rep)
	}
	ch := e.id(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id, receipt_id)
		values ('recibido', '66600001', 'Nación', '2026-11-04', 40000, 'cartera', $1, $2) returning id`, wood, r)
	e.exec(t, `update receipt_parts set cheque_id = $1 where receipt_id = $2`, ch, r)
	e.refijar(t, r)
	var marca string
	if err := e.pool.QueryRow(context.Background(), `select coalesce(circuito_reparto, '') from cheques where id = $1`, ch).Scan(&marca); err != nil || marca != "blanco" {
		t.Fatalf("el cheque es del archivo del estudio: %q %v", marca, err)
	}
	// La venta con Factura A a cuenta corriente, días después.
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at) values ($1, 'compra', 22932, 'PED-1038', '2026-11-10T15:00:00Z')`, wood)
	e.facturaConCae(t, &wood, 9, 22932, "2026-11-10T15:00:00Z", nil)

	nov := e.asientosDe(t, "2026-11")
	if n := cuenta(DelCircuito(nov, CircuitoNegro), Cuentas.VentasSinFactura); n != 0 {
		t.Errorf("Ventas sin factura del B: %v", n)
	}
	if n := len(DelCircuito(nov, CircuitoNegro)); n != 0 {
		t.Errorf("el B no tiene nada: %d asientos", n)
	}
	blanco := DelCircuito(nov, "")
	if n := cuenta(blanco, Cuentas.ValoresADepositar); n != 40000 {
		t.Errorf("Valores a depositar: %v", n)
	}
	if n := cuenta(blanco, Cuentas.AnticiposDeClientes); n != -17068 {
		t.Errorf("Anticipos queda con el saldo a favor (−17.068): %v", n)
	}
	if n := cuenta(blanco, Cuentas.Deudores); n != 0 {
		t.Errorf("la factura se cancela con el anticipo: %v", n)
	}
}

// El efectivo que sobra de un cobro a cuenta sigue la regla
// «excedente_cuenta_corriente» (de arranque, al B); lo bancarizado que sobra
// por encima de lo que debía en la cuenta no.
func TestElEfectivoQueSobraSigueLaRegla(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Rosa Moldava') returning id`)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at) values ($1, 'compra', 10000, 'PED-1001', '2026-11-01T15:00:00Z')`, cli)
	_, rep := e.reciboDe(t, &cli, nil, "REC-0021", "2026-11-03T15:00:00Z", [2]any{"efectivo", 15000.0}, [2]any{"transferencia", 30000.0})
	// Debía 10.000 sin factura: paga eso y sobran 35.000. De la sobra, los
	// 30.000 de la transferencia son anticipo; el efectivo que sobra (5.000)
	// y lo que pagó la deuda B (10.000) van al B.
	if rep.Anticipo != 30000 || rep.B != 15000 {
		t.Errorf("reparto: %+v", rep)
	}
}

// Recorrido M4-093 y M4-111: el cheque que un cliente informó desde el
// portal y se rechazó sin aceptarlo nunca entró a la cartera. No va a
// Valores a depositar ni a Movimientos a imputar, y el cierre no pide
// resolverlo. Uno aceptado y cargado sin cobro sí.
func TestElChequeInformadoYNoAceptadoNoSeAsienta(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	obra := e.id(t, `insert into customers (nombre) values ('Obra Barrio Parque') returning id`)
	no := e.id(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id, created_at)
		values ('recibido', '00440201', 'Galicia', '2026-11-20', 30000, 'informado', $1, '2026-11-10T15:00:00Z') returning id`, obra)
	e.exec(t, `update cheques set estado = 'rechazado' where id = $1`, no)
	si := e.id(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id, created_at)
		values ('recibido', '00440202', 'Galicia', '2026-11-20', 12000, 'informado', $1, '2026-11-10T15:00:00Z') returning id`, obra)
	e.exec(t, `update cheques set estado = 'cartera' where id = $1`, si)

	nov := DelCircuito(e.asientosDe(t, "2026-11"), "")
	if n := cuenta(nov, Cuentas.ValoresADepositar); n != 12000 {
		t.Errorf("Valores a depositar es la cartera (12.000): %v", n)
	}
	if a := buscarAsiento(nov, "Cheque N° 00440201"); a != nil {
		t.Errorf("el no aceptado no tiene asiento: %+v", a)
	}
	p := PeriodoDelCierre("2026-11", ahoraDePrueba)
	lista, err := e.s.PendientesDelCierre(ctx, p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range lista {
		if x.Clave == "a-imputar" && x.Cantidad != 1 {
			t.Errorf("a imputar cuenta solo el aceptado: %+v", x)
		}
	}
}

// Recorrido M4-112: la seña de un pedido que se entregó sin factura pasó al
// B como venta sin factura. Lo que una devolución le reintegra después sigue
// al cobro: sale del B (Ventas sin factura contra Caja) y no del archivo del
// estudio, donde dejaba Anticipos de la clienta en −62.010 y la Caja blanca
// en negativo.
func TestLaDevolucionDeUnaVentaQuePasoAlBVaPorElB(t *testing.T) {
	e := armar(t)
	e.staff(t, "admin@prueba.test", "admin")
	usuario := e.id(t, `select id from "user" limit 1`)
	lucia := e.id(t, `insert into customers (nombre) values ('Lucía') returning id`)
	pedido := e.pedido(t, "PED-1004", e.central, "pendiente", "mostrador", time.Date(2026, 11, 2, 12, 0, 0, 0, Argentina), &lucia)
	e.exec(t, `update orders set total = 220572 where id = $1`, pedido)
	r, rep := e.reciboDe(t, &lucia, &pedido, "REC-0002", "2026-11-02T15:00:00Z", [2]any{"efectivo", 220572.0})
	if rep.Anticipo != 220572 {
		t.Fatalf("la seña del pedido abierto: %+v", rep)
	}
	e.exec(t, `update orders set estado = 'entregado' where id = $1`, pedido)
	e.exec(t, `insert into order_status_history (order_id, estado, created_at) values ($1, 'entregado', '2026-11-03T15:00:00Z')`, pedido)
	dev := e.id(t, `insert into devoluciones (clave, order_id, importe, destino, motivo, created_by_user_id, created_at)
		values ('d-1004', $1, 62010, 'caja', 'sobró una bisagra', $2, '2026-11-05T15:00:00Z') returning id`, pedido, usuario)
	e.exec(t, `insert into receipt_refunds (receipt_id, devolucion_id, medio, importe, created_at) values ($1, $2, 'efectivo', 62010, '2026-11-05T15:00:00Z')`, r, dev)

	nov := e.asientosDe(t, "2026-11")
	blanco, b := DelCircuito(nov, ""), DelCircuito(nov, CircuitoNegro)
	if n := cuenta(blanco, Cuentas.AnticiposDeClientes); n != 0 {
		t.Errorf("Anticipos del estudio: %v", n)
	}
	if n := cuenta(blanco, Cuentas.Caja); n != 0 {
		t.Errorf("Caja del estudio: %v", n)
	}
	if n := cuenta(b, Cuentas.VentasSinFactura); n != -158562 {
		t.Errorf("Ventas sin factura del B (220.572 − 62.010): %v", n)
	}
	if n := cuenta(b, Cuentas.Caja); n != 158562 {
		t.Errorf("Caja del B: %v", n)
	}
}

// Recorrido M4-095: el cambio fijo con el que se abrió la primera caja está
// en el cajón y entra a Caja contra Saldos iniciales. El efectivo de una
// venta del B que se manda al banco: con la regla de arranque sale entero de
// la Caja del estudio (que queda en negativo, y «Resolver» lleva a la regla);
// con «lo_que_hay», de esa Caja hasta lo que tiene y el resto del B, contra
// Movimientos a imputar en los dos archivos.
func TestElDepositoDelEfectivoDelB(t *testing.T) {
	for _, regla := range []string{"estudio", "lo_que_hay"} {
		t.Run(regla, func(t *testing.T) {
			e := armar(t)
			ctx := context.Background()
			e.staff(t, "admin@prueba.test", "admin")
			if err := reglas.Fijar(ctx, e.pool, reglas.DepositoDeEfectivo, regla); err != nil {
				t.Fatal(err)
			}
			sesion := e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at, estado, cerrada_at, contado) select $1, id, '2026-11-02T11:00:00Z', 'cerrada', '2026-11-02T22:00:00Z', 80000 from "user" limit 1 returning id`, e.central)
			e.exec(t, `insert into cash_movements (session_id, tipo, monto, motivo, created_at) values ($1, 'apertura', 80000, 'Fondo inicial', '2026-11-02T11:00:00Z')`, sesion)
			// Un segundo turno arranca con lo que quedó: no es plata nueva.
			otra := e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) select $1, id, '2026-11-03T11:00:00Z' from "user" limit 1 returning id`, e.central)
			e.exec(t, `insert into cash_movements (session_id, tipo, monto, motivo, created_at) values ($1, 'apertura', 80000, 'Fondo inicial', '2026-11-03T11:00:00Z')`, otra)
			venta := e.pedido(t, "PED-1035", e.central, "entregado", "mostrador", time.Date(2026, 11, 3, 10, 0, 0, 0, Argentina), nil)
			e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, created_at)
				values ($1, 'pedido', 'mostrador', 'efectivo', 150000, 'aprobado', '2026-11-03T13:00:00Z')`, venta)
			e.exec(t, `insert into caja_fuerte_movimientos (branch_id, tipo, monto, motivo, clave, created_at)
				values ($1, 'deposito', 100000, 'Al banco', 'cf-1', '2026-11-04T13:00:00Z')`, e.central)

			nov := e.asientosDe(t, "2026-11")
			blanco, b := DelCircuito(nov, ""), DelCircuito(nov, CircuitoNegro)
			if n := cuenta(blanco, Cuentas.SaldosIniciales); n != -80000 {
				t.Errorf("el cambio fijo entra una vez contra Saldos iniciales: %v", n)
			}
			if n := cuenta(blanco, Cuentas.Banco); n != 100000 {
				t.Errorf("Banco: %v", n)
			}
			p := PeriodoDelCierre("2026-11", ahoraDePrueba)
			lista, err := e.s.PendientesDelCierre(ctx, p.Desde, p.Hasta)
			if err != nil {
				t.Fatal(err)
			}
			var negativos *PendienteDelCierre
			for i := range lista {
				if lista[i].Clave == "fondos-negativos" {
					negativos = &lista[i]
				}
			}
			if regla == "estudio" {
				if n := cuenta(blanco, Cuentas.Caja); n != -20000 {
					t.Errorf("Caja del estudio: %v", n)
				}
				if negativos == nil || negativos.Donde != "/admin/reglas" {
					t.Errorf("«Resolver» lleva a la regla: %+v", negativos)
				}
				return
			}
			if n := cuenta(blanco, Cuentas.Caja); n != 0 {
				t.Errorf("Caja del estudio: %v", n)
			}
			if n := cuenta(blanco, Cuentas.MovimientosAImputar); n != -20000 {
				t.Errorf("a imputar en el estudio: %v", n)
			}
			if n, m := cuenta(b, Cuentas.Caja), cuenta(b, Cuentas.MovimientosAImputar); n != 130000 || m != 20000 {
				t.Errorf("Caja del B %v, a imputar %v", n, m)
			}
			if negativos != nil {
				t.Errorf("sin fondos negativos: %+v", negativos)
			}
		})
	}
}

// Recorrido M4-113: «Plata hoy» muestra lo que hay en la caja fuerte, como
// /admin/caja: lo de días anteriores suma y lo que hoy se mandó al banco ya
// no está ahí, sino en lo que entró hoy al banco.
func TestPlataHoyLaCajaFuerteEsSuSaldo(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	usuario := e.id(t, `select id from "user" limit 1`)
	ayer := e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at, estado, cerrada_at, contado) values ($1, $2, '2026-10-14T12:00:00Z', 'cerrada', '2026-10-14T22:00:00Z', 0) returning id`, e.central, usuario)
	e.exec(t, `insert into cash_movements (session_id, tipo, monto, motivo, destino, created_at) values ($1, 'retiro', -300000, 'Cierre', 'caja_fuerte', '2026-10-14T21:00:00Z')`, ayer)
	hoy := e.id(t, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, $2, '2026-10-15T08:00:00Z') returning id`, e.central, usuario)
	e.exec(t, `insert into cash_movements (session_id, tipo, monto, motivo, destino, created_at) values
		($1, 'apertura', 100000, 'Fondo inicial', null, '2026-10-15T08:00:00Z'),
		($1, 'retiro', -100000, 'A la caja fuerte', 'caja_fuerte', '2026-10-15T08:03:00Z')`, hoy)
	e.exec(t, `insert into caja_fuerte_movimientos (branch_id, tipo, monto, motivo, clave, created_at)
		values ($1, 'deposito', 100000, 'Al banco', 'cf-hoy', '2026-10-15T08:05:00Z')`, e.central)
	_, cuerpo, _ := pedir(t, adm, e.u+"inicio/dueno")
	var n NumerosDelDueno
	if err := json.Unmarshal([]byte(cuerpo), &n); err != nil {
		t.Fatal(cuerpo)
	}
	if p := n.PlataHoy; p.CajaFuerte != 300000 || p.BancoEntro != 100000 {
		t.Errorf("caja fuerte %v (300.000), banco entró %v (100.000)", p.CajaFuerte, p.BancoEntro)
	}
}

// Recorrido M4-115: la retención cargada antes de cualquier factura con CAE
// espera en Anticipos y se aplica cuando la factura sale; Deudores no queda
// en negativo.
func TestLaRetencionSinFacturaEsperaEnAnticipos(t *testing.T) {
	e := armar(t)
	cons := e.id(t, `insert into customers (nombre) values ('Constructora') returning id`)
	_, rep := e.reciboDe(t, &cons, nil, "REC-0001", "2026-11-02T08:51:00Z", [2]any{"retencion", 12520.0})
	if rep.Anticipo != 12520 || rep.Deudores != 0 || rep.B != 0 {
		t.Fatalf("la retención sin factura: %+v", rep)
	}
	f := e.facturaSinCae(t, &cons, nil, 9, 42000, "2026-11-05T15:00:00Z")
	nov := DelCircuito(e.asientosDe(t, "2026-11"), "")
	if d, a := cuenta(nov, Cuentas.Deudores), cuenta(nov, Cuentas.AnticiposDeClientes); d != 0 || a != -12520 {
		t.Errorf("sin CAE: Deudores %v, Anticipos %v", d, a)
	}
	e.exec(t, `update invoices set cae = '7612', estado = 'autorizada', fecha_emision = '2026-11-06T15:00:00Z' where id = $1`, f)
	nov = DelCircuito(e.asientosDe(t, "2026-11"), "")
	if d, a := cuenta(nov, Cuentas.Deudores), cuenta(nov, Cuentas.AnticiposDeClientes); d != 29480 || a != 0 {
		t.Errorf("con CAE: Deudores %v (29.480), Anticipos %v", d, a)
	}
}

// Recorrido M4-100 y M4-116: el pedido tomado a cuenta corriente y todavía
// sin entregar ni facturar no es deuda del B: va en su columna. Y la seña
// que nombraba una factura que ya tiene CAE no es «cobro de facturas sin
// CAE»: es seña del pedido abierto.
func TestDeudoresElPedidoSinEntregarNoEsDelB(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "admin@prueba.test", "admin")
	obra := e.id(t, `insert into customers (nombre) values ('Obra Barrio Parque') returning id`)
	viejo := e.pedido(t, "PED-1019", e.central, "entregado", "mostrador", time.Date(2026, 11, 2, 12, 0, 0, 0, Argentina), &obra)
	e.exec(t, `update orders set total = 48400, medio_pago = 'cuenta_corriente' where id = $1`, viejo)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at) values ($1, 'compra', 48400, 'PED-1019', '2026-11-02T15:00:00Z')`, obra)
	f := e.facturaSinCae(t, &obra, &viejo, 30, 48400, "2026-11-02T15:00:00Z")
	abierto := e.pedido(t, "PED-1024", e.central, "pendiente", "tienda", time.Date(2026, 11, 3, 12, 0, 0, 0, Argentina), &obra)
	e.exec(t, `update orders set total = 826800, medio_pago = 'cuenta_corriente' where id = $1`, abierto)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, created_at) values ($1, 'compra', 826800, 'PED-1024', '2026-11-03T15:00:00Z')`, obra)
	r, rep := e.reciboDe(t, &obra, nil, "REC-0008", "2026-11-04T15:00:00Z", [2]any{"transferencia", 589700.0})
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, referencia, receipt_id, created_at) values ($1, 'pago', -589700, 'REC-0008', $2, '2026-11-04T15:00:00Z')`, obra, r)
	if rep.Anticipo != 589700 {
		t.Fatalf("seña: %+v", rep)
	}
	// La factura del pedido viejo ya tiene su CAE.
	e.exec(t, `update invoices set cae = '7612', estado = 'autorizada', fecha_emision = '2026-11-05T15:00:00Z' where id = $1`, f)

	d, err := e.s.CsvDeudores(ctx, time.Date(2026, 11, 27, 12, 0, 0, 0, Argentina))
	if err != nil {
		t.Fatal(err)
	}
	// Debe 826.800 + 48.400 − 589.700 = 285.500: nada con CAE (la seña pagó la
	// factura), todo del pedido sin entregar y nada del B.
	if !strings.Contains(d, ";285500,00;") || !strings.Contains(d, ";0,00;0,00;285500,00;0,00\r") {
		t.Errorf("deudores:\n%s", d)
	}
	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-11")
	p := pendientesDe(t, cuerpo)
	if _, ok := p["cobros-sin-cae"]; ok {
		t.Errorf("no hay facturas sin CAE: %s", cuerpo)
	}
	if _, ok := p["senas-del-mes"]; !ok {
		t.Errorf("es la seña del pedido abierto: %s", cuerpo)
	}
}

// Recorrido M4-118: la venta interna del mostrador cobrada por
// transferencia entra al Banco del archivo B; el aviso del banco en el B la
// cuenta.
func TestElAvisoDelBancoEnElBCuentaLasVentasPorTransferencia(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	venta := e.pedido(t, "PED-1012", e.central, "entregado", "mostrador", time.Date(2026, 11, 4, 12, 0, 0, 0, Argentina), nil)
	e.exec(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado, created_at)
		values ($1, 'pedido', 'mostrador', 'transferencia', 71280, 'aprobado', '2026-11-04T15:00:00Z')`, venta)
	if n := cuenta(DelCircuito(e.asientosDe(t, "2026-11"), CircuitoNegro), Cuentas.Banco); n != 71280 {
		t.Fatalf("el Banco del B: %v", n)
	}
	_, cuerpo, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-11")
	p, ok := pendientesDe(t, cuerpo)["banco-b"]
	if !ok || p.Cantidad != 1 || !strings.Contains(p.Detalle, "71.280") {
		t.Errorf("el aviso: %+v (%s)", p, cuerpo)
	}
}
