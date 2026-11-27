package reportes

import (
	"context"
	"testing"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/cobros"
	"mjbj/internal/sqlc"
)

// Los cheques y el IVA en los asientos (revisión del comité, hallazgo 17).

func TestPosicionDeIva(t *testing.T) {
	casos := []struct {
		nombre                                     string
		debito, credito, tecnico, perc, ret, libre float64
		aDepositar, saldoTecnico, saldoLibre       float64
	}{
		{"débito menos crédito", 2100, 1000, 0, 0, 0, 0, 1100, 0, 0},
		{"con percepciones y retenciones", 2100, 1000, 0, 100, 50, 0, 950, 0, 0},
		// El crédito que supera al débito es saldo técnico, y las
		// percepciones de ese mes quedan enteras de libre disponibilidad.
		{"saldo técnico", 1000, 1500, 0, 80, 0, 0, 0, 500, 80},
		{"arrastra los dos saldos", 2100, 1000, 500, 0, 0, 80, 520, 0, 0},
		{"las percepciones sobran", 1200, 1000, 0, 300, 0, 0, 0, 0, 100},
	}
	for _, c := range casos {
		p := CalcularPosicionDeIva(c.debito, c.credito, c.tecnico, c.perc, c.ret, c.libre)
		if p.ADepositar != c.aDepositar || p.SaldoTecnico != c.saldoTecnico || p.SaldoLibre != c.saldoLibre {
			t.Errorf("%s: %+v", c.nombre, p)
		}
		if p.ADepositar < 0 {
			t.Errorf("%s: a depositar negativo", c.nombre)
		}
	}
}

func TestChequeDiferidoEnFechaArgentina(t *testing.T) {
	// El cheque del 18 (a las 12 de Argentina, como lo guarda el formulario)
	// y el pago del 18 a las 23:30 de Argentina, que en UTC ya es 19: es del
	// mismo día, no es diferido.
	cheque := time.Date(2026, 11, 18, 12, 0, 0, 0, Argentina)
	if ChequeDiferido(cheque, time.Date(2026, 11, 19, 2, 30, 0, 0, time.UTC)) {
		t.Error("el del mismo día salió diferido")
	}
	if !ChequeDiferido(cheque, time.Date(2026, 11, 17, 15, 0, 0, 0, Argentina)) {
		t.Error("el del día siguiente al pago no salió diferido")
	}
}

func TestAsientosDeLosCheques(t *testing.T) {
	casos := []struct {
		nombre      string
		c           ChequeAAsentar
		debe, haber string
	}{
		{"recibido acreditado", ChequeAAsentar{Sentido: "recibido", Desde: "depositado", Hacia: "acreditado"}, Cuentas.Banco, Cuentas.ValoresADepositar},
		{"recibido rechazado", ChequeAAsentar{Sentido: "recibido", Desde: "depositado", Hacia: "rechazado", ADeudores: true}, Cuentas.Deudores, Cuentas.ValoresADepositar},
		{"endosado rechazado", ChequeAAsentar{Sentido: "recibido", Desde: "entregado", Hacia: "rechazado", ADeudores: true}, Cuentas.Deudores, Cuentas.Proveedores},
		{"propio diferido acreditado", ChequeAAsentar{Sentido: "entregado", Desde: "entregado", Hacia: "acreditado", Diferido: true}, Cuentas.ChequesDiferidos, Cuentas.Banco},
		{"propio diferido rechazado", ChequeAAsentar{Sentido: "entregado", Desde: "entregado", Hacia: "rechazado", Diferido: true}, Cuentas.ChequesDiferidos, Cuentas.Proveedores},
		{"propio al día rechazado", ChequeAAsentar{Sentido: "entregado", Desde: "entregado", Hacia: "rechazado"}, Cuentas.Banco, Cuentas.Proveedores},
	}
	for _, c := range casos {
		c.c.Importe, c.c.Numero = 1000, "123"
		a, ok := AsientoDeCheque(c.c)
		if !ok || !a.Balancea || a.Renglones[0].Cuenta != c.debe || a.Renglones[1].Cuenta != c.haber {
			t.Errorf("%s: %v %+v", c.nombre, ok, a.Renglones)
		}
	}
	// Lo que no mueve cuentas: el endosado que cobró el proveedor, el propio
	// al día que debitó el banco, el rechazo de uno que no había bajado deuda.
	for _, c := range []ChequeAAsentar{
		{Sentido: "recibido", Desde: "entregado", Hacia: "acreditado"},
		{Sentido: "entregado", Desde: "entregado", Hacia: "acreditado"},
		{Sentido: "recibido", Desde: "cartera", Hacia: "rechazado"},
		{Sentido: "recibido", Desde: "cartera", Hacia: "anulado"},
	} {
		if _, ok := AsientoDeCheque(c); ok {
			t.Errorf("asentó %+v", c)
		}
	}
	// El rechazo del cheque de una venta del mostrador que quedó en el B da
	// vuelta su cobro en el B (mes simulado): la venta sin factura se cobró
	// con Valores a depositar y ahora vuelve a deberse.
	if a, ok := AsientoDeCheque(ChequeAAsentar{Sentido: "recibido", Desde: "depositado", Hacia: "rechazado", ADeudores: true, Importe: 300,
		Circuito: CircuitoNegro, DelMostradorEnB: true}); !ok || a.Circuito != CircuitoNegro ||
		a.Renglones[0] != renglon(Cuentas.VentasSinFactura, 300, 0) || a.Renglones[1] != renglon(Cuentas.ValoresADepositar, 0, 300) {
		t.Errorf("el rechazo del cheque B del mostrador: %v %+v", ok, a)
	}
}

// El pago con un cheque propio diferido va a Cheques diferidos y no a Banco;
// cuando el banco lo rechaza, la deuda vuelve al libro del proveedor y el
// asiento la reabre contra Proveedores: libro y mayor dicen lo mismo.
func TestPagoConChequeDiferidoQueRebota(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	e.staff(t, "cheques@prueba.test", sqlc.StaffRoleAdmin)
	usuario := e.id(t, `select id from "user" where email = 'cheques@prueba.test'`)
	prov := e.id(t, `insert into suppliers (nombre) values ('Faplac') returning id`)
	pago := e.id(t, `insert into supplier_payments (supplier_id, fecha, total, neto, medio) values ($1, '2026-10-10T15:00:00Z', 1000, 1000, 'cheque') returning id`, prov)
	cheque := e.id(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado) values ('entregado', '00012345', 'Galicia',
		'2026-11-10T15:00:00Z', 1000, 'entregado') returning id`)
	e.exec(t, `insert into supplier_payment_parts (payment_id, medio, importe, cheque_id) values ($1, 'cheque', 1000, $2)`, pago, cheque)
	e.exec(t, `insert into supplier_movements (supplier_id, tipo, monto, supplier_payment_id, created_at) values ($1, 'pago', -1000, $2, '2026-10-10T15:00:00Z')`, prov, pago)

	asientos := e.asientosDe(t, "2026-10")
	if c := cuenta(asientos, Cuentas.ChequesDiferidos); c != -1000 {
		t.Errorf("Cheques diferidos %v, quería −1000 (haber)", c)
	}
	if c := cuenta(asientos, Cuentas.Banco); c != 0 {
		t.Errorf("Banco %v: el cheque diferido no sale del banco al pagar", c)
	}

	svc := cobros.Nuevo(e.pool, silencio)
	if _, err := svc.CambiarEstado(ctx, &auth.Sesion{UserID: usuario, Nombre: "Admin"}, cheque, "rechazado", "Sin fondos"); err != nil {
		t.Fatal(err)
	}
	var quien string
	if err := e.pool.QueryRow(ctx, `select coalesce(created_by_user_id, '') from cheque_estados where cheque_id = $1 and hacia = 'rechazado'`, cheque).Scan(&quien); err != nil {
		t.Fatal(err)
	}
	if quien != usuario {
		t.Errorf("el cambio de estado quedó a nombre de %q", quien)
	}
	var saldo float64
	if err := e.pool.QueryRow(ctx, `select sum(monto)::float8 from supplier_movements where supplier_id = $1`, prov).Scan(&saldo); err != nil {
		t.Fatal(err)
	}
	if saldo != 0 {
		t.Errorf("el libro del proveedor quedó en %v: el rechazo tiene que reabrir la deuda", saldo)
	}
	var mes string
	if err := e.pool.QueryRow(ctx, `select to_char(at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') from cheque_estados where cheque_id = $1`, cheque).Scan(&mes); err != nil {
		t.Fatal(err)
	}
	asientos = e.asientosDe(t, mes)
	if c := cuenta(asientos, Cuentas.Proveedores); c != -1000 {
		t.Errorf("Proveedores %v en el mes del rechazo, quería −1000 (haber: le volvemos a deber)", c)
	}
	if c := cuenta(asientos, Cuentas.ChequesDiferidos); c != 1000 {
		t.Errorf("Cheques diferidos %v en el mes del rechazo", c)
	}
}

// El saldo técnico de un mes se usa en el siguiente.
func TestElSaldoDeIvaPasaAlMesSiguiente(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	prov := e.id(t, `insert into suppliers (nombre) values ('Faplac') returning id`)
	// Septiembre: 2100 de crédito y 1000 de débito: 1100 de saldo técnico.
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, total)
		values ($1, 'factura_a', 1, 1, '2026-09-10', 10000, 2100, 12100)`, prov)
	e.facturaConCae(t, nil, 1, 5761.90, "2026-09-15T15:00:00Z", nil)
	// Octubre: 1500 de débito, 0 de crédito, 100 de percepción.
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, percepciones, percepcion_iva, total)
		values ($1, 'factura_c', 1, 2, '2026-10-10', 1000, 0, 100, 100, 1100)`, prov)
	e.facturaConCae(t, nil, 2, 8642.86, "2026-10-15T15:00:00Z", nil)
	p := PeriodoDelCierre("2026-10", ahoraDePrueba)
	r, err := e.s.ResumenDelMes(ctx, p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	iva := r.Iva
	if iva.SaldoTecnicoAnterior < 1099.99 || iva.SaldoTecnicoAnterior > 1100.01 {
		t.Fatalf("saldo técnico de septiembre %+v", iva)
	}
	// 1500 − 1100 de saldo técnico = 400, menos 100 de percepción = 300.
	if iva.ADepositar < 299.99 || iva.ADepositar > 300.01 || iva.Percepciones != 100 {
		t.Errorf("octubre: %+v", iva)
	}
}

// La posición arranca de la última DDJJ: lo de antes del arranque (las
// compras de la puesta en marcha) no se arrastra, el saldo de arranque sí, y
// la factura de compra de un mes ya presentado que se carga después cuenta
// en el mes en que se cargó. Sin arranque, la posición lo dice y el cierre
// lo pide.
func TestLaPosicionDeIvaArrancaDeLaDDJJ(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	prov := e.id(t, `insert into suppliers (nombre) values ('Faplac') returning id`)
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, total)
		values ($1, 'factura_a', 1, 1, '2026-08-10', 10000, 2100, 12100)`, prov)
	e.facturaConCae(t, nil, 2, 8642.86, "2026-10-15T15:00:00Z", nil)
	p := PeriodoDelCierre("2026-10", ahoraDePrueba)
	r, err := e.s.ResumenDelMes(ctx, p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Iva.SinArranque {
		t.Errorf("sin arranque cargado: %+v", r.Iva)
	}
	pend, err := e.s.PendientesDelCierre(ctx, p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	hay := false
	for _, x := range pend {
		hay = hay || x.Clave == "iva-arranque"
	}
	if !hay {
		t.Errorf("el cierre no pide el arranque: %+v", pend)
	}
	// La DDJJ de septiembre dejó 200 de saldo técnico y 50 de libre
	// disponibilidad.
	e.exec(t, `insert into configuracion_fiscal (razon_social) select 'Maderera' where not exists (select 1 from configuracion_fiscal)`)
	e.exec(t, `update configuracion_fiscal set iva_desde = '2026-10-01', iva_saldo_tecnico = 200, iva_saldo_libre = 50,
		iva_anclado_at = '2026-10-05T12:00:00Z'`)
	r, err = e.s.ResumenDelMes(ctx, p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	// 1500 de débito − 200 de técnico − 50 de libre = 1250; el crédito de
	// agosto no se arrastra.
	if r.Iva.SinArranque || r.Iva.SaldoTecnicoAnterior != 200 || r.Iva.ADepositar < 1249.99 || r.Iva.ADepositar > 1250.01 {
		t.Errorf("con arranque: %+v", r.Iva)
	}
	// Una factura de septiembre cargada el 20/10: cuenta en octubre.
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, total, created_at)
		values ($1, 'factura_a', 1, 3, '2026-09-20', 1000, 210, 1210, '2026-10-20T12:00:00Z')`, prov)
	r, err = e.s.ResumenDelMes(ctx, p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	if r.Iva.Credito != 210 || r.Iva.ADepositar < 1039.99 || r.Iva.ADepositar > 1040.01 {
		t.Errorf("la cargada tarde: %+v", r.Iva)
	}
}

// La retención que nos practicó el cliente va a la cuenta de su impuesto.
func TestRetencionSufridaPorImpuesto(t *testing.T) {
	e := armar(t)
	cli := e.id(t, `insert into customers (nombre) values ('Obra') returning id`)
	e.facturaConCae(t, &cli, 1, 1000, "2026-10-01T15:00:00Z", nil)
	recibo := e.recibir(t, &cli, "R-1", "2026-10-05T15:00:00Z", [2]any{"transferencia", 900.0}, [2]any{"retencion", 100.0})
	e.exec(t, `insert into retenciones_sufridas (customer_id, numero, impuesto, base, importe, fecha, receipt_id) values
		($1, 'C-1', 'iva', 1000, 60, '2026-10-05', $2), ($1, 'C-2', 'ganancias', 1000, 40, '2026-10-05', $2)`, cli, recibo)
	asientos := e.asientosDe(t, "2026-10")
	if c := cuenta(asientos, Cuentas.RetSufridaIva); c != 60 {
		t.Errorf("Retenciones sufridas IVA %v", c)
	}
	if c := cuenta(asientos, Cuentas.RetSufridaGanancias); c != 40 {
		t.Errorf("Retenciones sufridas Ganancias %v", c)
	}
	if c := cuenta(asientos, Cuentas.RetencionesSufridas); c != 0 {
		t.Errorf("quedaron %v sin impuesto", c)
	}
}
