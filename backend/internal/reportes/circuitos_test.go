package reportes

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
)

// recibir es un recibo como lo deja cobros.EmitirRecibo: con sus partes y el
// reparto fijado en el momento (FijarReparto, con lo que había hasta ahí).
func (e *entorno) recibir(t *testing.T, cliente *string, numero, cuando string, partes ...[2]any) string {
	t.Helper()
	total := 0.0
	for _, p := range partes {
		total += p[1].(float64)
	}
	id := e.id(t, `insert into receipts (numero, customer_id, recibido_de, total, origen, created_at) values ($1, $2, 'Cliente', $3, 'panel', $4) returning id`,
		numero, cliente, total, cuando)
	for i, p := range partes {
		e.exec(t, `insert into receipt_parts (receipt_id, medio, importe, orden) values ($1, $2, $3, $4)`, id, p[0], p[1], i)
	}
	if err := pgx.BeginFunc(context.Background(), e.pool, func(tx pgx.Tx) error {
		_, err := cobros.FijarReparto(context.Background(), tx, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

func (e *entorno) facturaConCae(t *testing.T, cliente *string, numero int, total float64, cuando string, pedido *string) string {
	t.Helper()
	neto := redondear(total / 1.21)
	return e.id(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado,
		fecha_emision, cae, customer_id, order_id) values ('factura_b', 3, $1, 'Cliente', $2, $3, 0, 0, 0, $4, 'autorizada', $5, '7612', $6, $7) returning id`,
		numero, neto, redondear(total-neto), total, cuando, cliente, pedido)
}

func (e *entorno) asientosDe(t *testing.T, periodo string) []Asiento {
	t.Helper()
	p := PeriodoDelCierre(periodo, ahoraDePrueba)
	a, err := e.s.AsientosDelPeriodo(context.Background(), p.Desde, p.Hasta)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range a {
		if !x.Balancea {
			t.Errorf("no cierra: %+v", x)
		}
	}
	return a
}

func cuenta(asientos []Asiento, cuenta string) float64 {
	neto := 0.0
	for _, a := range asientos {
		for _, r := range a.Renglones {
			if r.Cuenta == cuenta {
				neto += r.Debe - r.Haber
			}
		}
	}
	return redondear(neto)
}

// **El CSV del estudio mezclaba el circuito B.** Los gastos y pagos «en
// negro» entraban a los asientos de este CUIT, y los recibos que cobraban
// ventas sin factura iban contra un Deudores que nunca se debitó. Ahora cada
// recibo se reparte: lo facturado con CAE a Deudores, la seña a Anticipos de
// clientes (y se aplica cuando sale la factura) y lo que paga ventas sin
// factura al B. Las retenciones, siempre blancas.
func TestReciboPorCircuito(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	cliente := func(nombre string) *string {
		id := e.id(t, `insert into customers (nombre) values ($1) returning id`, nombre)
		return &id
	}
	// Un gasto y un pago a proveedor en negro, y los mismos en blanco.
	prov := e.id(t, `insert into suppliers (nombre) values ('Maderas del Sur') returning id`)
	e.exec(t, `insert into expenses (fecha, categoria, descripcion, importe, medio, circuito) values
		('2026-10-03T00:00:00Z', 'flete', 'en blanco', 100, 'efectivo', 'blanco'), ('2026-10-04T00:00:00Z', 'flete', 'en negro', 70, 'efectivo', 'negro')`)
	e.exec(t, `insert into supplier_payments (supplier_id, total, neto, medio, referencia, fecha, circuito) values
		($1, 300, 300, 'transferencia', 'TR blanco', '2026-10-08T15:00:00Z', 'blanco'), ($1, 200, 200, 'efectivo', 'en mano', '2026-10-09T15:00:00Z', 'negro')`, prov)

	// Una venta sin factura: el recibo es todo B.
	sinFactura := cliente("Sin factura")
	e.pedido(t, "M-1", e.central, "entregado", "mostrador", time.Date(2026, 10, 2, 12, 0, 0, 0, Argentina), sinFactura)
	e.recibir(t, sinFactura, "R-B", "2026-10-05T15:00:00Z", [2]any{"efectivo", 500.0})

	// Una factura de 1000 y una venta sin factura de 400 en el mismo
	// recibo, con una retención de 50: 1000 a Deudores (la retención
	// adentro) y 400 al B.
	mixto := cliente("Mixto")
	e.facturaConCae(t, mixto, 10, 1000, "2026-10-06T15:00:00Z", nil)
	mixtoRecibo := e.recibir(t, mixto, "R-MIX", "2026-10-07T15:00:00Z", [2]any{"retencion", 50.0}, [2]any{"efectivo", 750.0}, [2]any{"transferencia", 600.0})

	// La seña: un pedido abierto, la seña antes de la factura, la factura
	// con CAE y el saldo. Todo termina en Deudores, nada en el B.
	sena := cliente("Seña")
	pedido := e.pedido(t, "P-1", e.central, "pendiente", "mostrador", time.Date(2026, 10, 10, 12, 0, 0, 0, Argentina), sena)
	e.exec(t, `update orders set total = 1000 where id = $1`, pedido)
	e.recibir(t, sena, "R-SEÑA", "2026-10-11T15:00:00Z", [2]any{"transferencia", 300.0})
	e.facturaConCae(t, sena, 11, 1000, "2026-10-20T15:00:00Z", &pedido)
	e.recibir(t, sena, "R-SALDO", "2026-10-25T15:00:00Z", [2]any{"transferencia", 700.0})

	// La retención con excedente y sin nada facturado: la retención es
	// blanca igual, el resto B.
	ret := cliente("Retención")
	e.recibir(t, ret, "R-RET", "2026-10-26T15:00:00Z", [2]any{"retencion", 30.0}, [2]any{"efectivo", 70.0})

	// Se anula el mixto en octubre: el mismo reparto, al revés.
	e.exec(t, `update receipts set estado = 'anulado', anulado_at = '2026-10-28T15:00:00Z' where id = $1`, mixtoRecibo)

	octubre := e.asientosDe(t, "2026-10")
	blanco, b := DelCircuito(octubre, "blanco"), DelCircuito(octubre, CircuitoNegro)
	conceptos := func(as []Asiento) string {
		var c []string
		for _, a := range as {
			c = append(c, a.Concepto)
		}
		return strings.Join(c, " | ")
	}
	for _, x := range []string{"en negro", "en mano", "Recibo R-B"} {
		if strings.Contains(conceptos(blanco), x) {
			t.Errorf("%q en el CSV del estudio: %s", x, conceptos(blanco))
		}
		if !strings.Contains(conceptos(b), x) {
			t.Errorf("%q no está en el B: %s", x, conceptos(b))
		}
	}
	mix := buscarAsiento(blanco, "Recibo R-MIX")
	if mix == nil || mix.Renglones[0] != renglon(Cuentas.RetencionesSufridas, 50, 0) ||
		mix.Renglones[len(mix.Renglones)-1] != renglon(Cuentas.Deudores, 0, 1000) {
		t.Fatalf("el mixto en blanco: %+v", mix)
	}
	if mb := buscarAsiento(b, "Recibo R-MIX"); mb == nil || mb.Renglones[len(mb.Renglones)-1] != renglon(Cuentas.VentasSinFactura, 0, 400) {
		t.Fatalf("el mixto en B: %+v", mb)
	}
	if an := buscarAsiento(b, "Anulación del recibo R-MIX"); an == nil || an.Renglones[len(an.Renglones)-1] != renglon(Cuentas.VentasSinFactura, 400, 0) {
		t.Fatalf("la anulación en B: %+v", an)
	}
	if an := buscarAsiento(blanco, "Anulación del recibo R-MIX"); an == nil || an.Renglones[len(an.Renglones)-1] != renglon(Cuentas.Deudores, 1000, 0) {
		t.Fatalf("la anulación en blanco: %+v", an)
	}
	if ap := buscarAsiento(blanco, "Aplica anticipo"); ap == nil || ap.Renglones[0] != renglon(Cuentas.AnticiposDeClientes, 300, 0) {
		t.Fatalf("la seña aplicada: %+v", ap)
	}
	if r := buscarAsiento(blanco, "Recibo R-RET"); r == nil || len(r.Renglones) != 2 || r.Renglones[1] != renglon(Cuentas.Deudores, 0, 30) {
		t.Fatalf("la retención: %+v", r)
	}
	// Anticipos cierra en cero; Deudores queda con lo que de verdad se debe
	// facturado: la factura de Mixto (su recibo se anuló) menos la retención
	// sin factura de Retención.
	if a := cuenta(blanco, Cuentas.AnticiposDeClientes); a != 0 {
		t.Errorf("Anticipos: %v", a)
	}
	if d := cuenta(blanco, Cuentas.Deudores); d != 970 {
		t.Errorf("Deudores: %v", d)
	}
	if strings.Contains(conceptos(b), "Seña") || buscarAsiento(b, "Recibo R-SEÑA") != nil {
		t.Errorf("la seña no es B: %s", conceptos(b))
	}

	// El CSV: el del estudio sin el B, y el B aparte, con la B en el nombre.
	_, csv, h := pedir(t, adm, e.u+"cierre/asientos-csv?periodo=2026-10")
	if strings.Contains(csv, "en negro") || !strings.Contains(h.Get("Content-Disposition"), "asientos-2026-10.csv") {
		t.Errorf("csv del estudio: %s", csv)
	}
	_, csv, h = pedir(t, adm, e.u+"cierre/asientos-csv?periodo=2026-10&circuito=negro")
	if !strings.Contains(csv, "en negro") || strings.Contains(csv, "en blanco") || !strings.Contains(h.Get("Content-Disposition"), "asientos-B-2026-10.csv") {
		t.Errorf("csv del B: %s %v", csv, h)
	}
	_, lista, _ := pedir(t, adm, e.u+"cierre/asientos?periodo=2026-10")
	if strings.Contains(lista, "en negro") {
		t.Errorf("la lista del cierre muestra el B: %s", lista)
	}

	// La deuda de Retención queda a favor en Deudores: se avisa.
	_, pend, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	if !strings.Contains(pend, `"clave":"deudores"`) {
		t.Errorf("pendientes: %s", pend)
	}
}

// **Lo que octubre le mandó al estudio no cambia en noviembre.** El reparto
// de cada recibo se fija al emitirlo: una nota de crédito, una factura nueva
// o una baja del mes siguiente no lo recalculan. Y un comprobante emitido en
// octubre y autorizado en noviembre (con la fecha de hoy) no aparece en
// octubre, aparece una sola vez en noviembre y se avisa en su cierre.
func TestOctubreNoCambiaEnNoviembre(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	cli := e.id(t, `insert into customers (nombre) values ('Gómez') returning id`)
	e.facturaConCae(t, &cli, 20, 1000, "2026-10-05T15:00:00Z", nil)
	e.recibir(t, &cli, "R-1", "2026-10-06T15:00:00Z", [2]any{"efectivo", 600.0})
	// Emitido en octubre, sin CAE.
	tarde := e.id(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision,
		customer_id, created_at) values ('factura_b', 3, 21, 'Gómez', 826.45, 173.55, 0, 0, 0, 1000, 'rechazada', '2026-10-20T15:00:00Z', $1,
		'2026-10-20T15:00:00Z') returning id`, cli)
	csv := func(periodo string) string {
		_, b, _ := pedir(t, adm, e.u+"cierre/asientos-csv?periodo="+periodo)
		return b
	}
	antes := csv("2026-10")
	if strings.Contains(antes, "00000021") {
		t.Fatalf("sin CAE no va: %s", antes)
	}

	// Noviembre: una nota de crédito, una factura nueva, un recibo y el de
	// octubre que sale con la fecha del día.
	e.exec(t, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, customer_id)
		values ('nota_credito_b', 3, 1, 'Gómez', 330.58, 69.42, 0, 0, 0, 400, 'autorizada', '2026-11-02T15:00:00Z', '7699', $1)`, cli)
	e.facturaConCae(t, &cli, 22, 500, "2026-11-03T15:00:00Z", nil)
	e.recibir(t, &cli, "R-2", "2026-11-04T15:00:00Z", [2]any{"efectivo", 900.0})
	e.exec(t, `update invoices set cae = '7700', estado = 'autorizada', fecha_emision_original = fecha_emision, fecha_emision = '2026-11-05T15:00:00Z' where id = $1`, tarde)

	if despues := csv("2026-10"); despues != antes {
		t.Fatalf("octubre cambió:\n%s\n---\n%s", antes, despues)
	}
	nov := csv("2026-11")
	if strings.Count(nov, `;"Factura B 0003-00000021 · Gómez";`) != 3 {
		t.Errorf("el autorizado tarde en noviembre: %s", nov)
	}
	_, pend, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-11")
	if !strings.Contains(pend, `"clave":"fuera-de-mes"`) {
		t.Errorf("pendientes de noviembre: %s", pend)
	}
	// Deudores de punta a punta: lo de octubre más lo de noviembre es lo
	// que queda facturado y sin cobrar (1000 − 600 − 400 + 500 + 1000 − 900).
	// Los 400 del recibo de noviembre que pasaban lo facturado quedaron de
	// anticipo (el de octubre esperaba el CAE) y se aplicaron al autorizarse.
	oct, nv := e.asientosDe(t, "2026-10"), e.asientosDe(t, "2026-11")
	if d := redondear(cuenta(oct, Cuentas.Deudores) + cuenta(nv, Cuentas.Deudores)); d != 600 {
		t.Errorf("Deudores al 30/11: %v", d)
	}
}

// Un pago en negro imputado a una factura de compra en blanco deja
// Proveedores abierto en el CSV del estudio: se avisa en el cierre.
func TestPagoBDeFacturaBlanca(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	prov := e.id(t, `insert into suppliers (nombre) values ('Aserradero Norte') returning id`)
	f := e.id(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, neto, iva21, iva105, iva27, percepciones, total, fecha_emision)
		values ($1, 'factura_a', 1, 1, 1000, 210, 0, 0, 0, 1210, '2026-10-02T00:00:00Z') returning id`, prov)
	pago := e.id(t, `insert into supplier_payments (supplier_id, total, neto, medio, fecha, circuito) values ($1, 1210, 1210, 'efectivo', '2026-10-09T15:00:00Z', 'negro') returning id`, prov)
	e.exec(t, `insert into supplier_payment_allocations (payment_id, purchase_invoice_id, importe) values ($1, $2, 1210)`, pago, f)
	_, pend, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	if !strings.Contains(pend, `"clave":"pagos-b"`) {
		t.Errorf("pendientes: %s", pend)
	}
}

// **Lo bancarizado va primero al blanco.** Retención 50, efectivo 750 y
// transferencia 600, con 1000 a Deudores y 400 al B: la transferencia queda
// entera en el blanco (el extracto muestra 600 y el estudio asienta 600), y
// el B sale del efectivo. Un cheque del B va entero al B.
func TestPartesPorCircuito(t *testing.T) {
	partes := []ParteDeRecibo{{Medio: "retencion", Importe: 50}, {Medio: "efectivo", Importe: 750}, {Medio: "transferencia", Importe: 600}}
	bl, b := PartesPorCircuito(partes, cobros.Reparto{Deudores: 1000, B: 400})
	suma := func(p []ParteDeRecibo) float64 {
		s := 0.0
		for _, x := range p {
			s += x.Importe
		}
		return redondear(s)
	}
	if suma(bl) != 1000 || suma(b) != 400 || bl[0] != (ParteDeRecibo{Medio: "retencion", Importe: 50}) {
		t.Fatalf("%+v %+v", bl, b)
	}
	if len(b) != 1 || b[0] != (ParteDeRecibo{Medio: "efectivo", Importe: 400}) {
		t.Fatalf("la transferencia en el B: %+v", b)
	}
	if bl, b := PartesPorCircuito([]ParteDeRecibo{{Medio: "efectivo", Importe: 100}}, cobros.Reparto{B: 100}); len(bl) != 0 || suma(b) != 100 {
		t.Fatalf("todo B: %+v %+v", bl, b)
	}
	// 60.000 en efectivo y 40.000 en un cheque del B contra 60.000 facturados.
	bl, b = PartesPorCircuito([]ParteDeRecibo{{Medio: "efectivo", Importe: 60000}, {Medio: "cheque", Importe: 40000, Negro: true}},
		cobros.Reparto{Deudores: 60000, B: 40000})
	if len(bl) != 1 || bl[0].Medio != "efectivo" || len(b) != 1 || !b[0].Negro || b[0].Importe != 40000 {
		t.Fatalf("el cheque del B: %+v %+v", bl, b)
	}
	// Un cheque del B nunca completa lo blanco, aunque el reparto lo pida.
	if bl, b := PartesPorCircuito([]ParteDeRecibo{{Medio: "efectivo", Importe: 50}, {Medio: "cheque", Importe: 100, Negro: true}},
		cobros.Reparto{Deudores: 150}); suma(bl) != 50 || len(b) != 1 || !b[0].Negro || b[0].Importe != 100 {
		t.Fatalf("el cheque del B completó lo blanco: %+v %+v", bl, b)
	}
	// Todo por transferencia y una parte B: lo bancarizado que queda en el B
	// se marca.
	if x := BancarizadoEnB([]ParteDeRecibo{{Medio: "transferencia", Importe: 1000}}, cobros.Reparto{Deudores: 700, B: 300}); x != 300 {
		t.Fatalf("bancarizado en B: %v", x)
	}
}

// El listado de deudores del contador sale del reparto y el mayor de 1.1.03
// de los asientos (comité final, M7): si no coinciden, el cierre lo dice.
// Con las facturas y los recibos de siempre coinciden. El cheque rechazado
// que le devuelve la deuda al cliente mueve 1.1.03, y el reparto también lo
// cuenta (revisión del carril E): el cliente figura en el listado con lo que
// debe y los dos siguen coincidiendo. Antes el listado lo dejaba afuera y el
// aviso quedaba encendido todos los meses.
func TestElListadoDeDeudoresContraElMayor(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	cli := e.id(t, `insert into customers (nombre) values ('Gómez') returning id`)
	e.facturaConCae(t, &cli, 40, 1000, "2026-10-05T15:00:00Z", nil)
	e.recibir(t, &cli, "R-1", "2026-10-06T15:00:00Z", [2]any{"transferencia", 400.0})
	_, pend, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	if strings.Contains(pend, `"clave":"deudores-mayor"`) {
		t.Errorf("coinciden y se avisa: %s", pend)
	}
	cheque := e.id(t, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id) values ('recibido', '77', 'Nación', '2026-10-10', 200, 'cartera', $1) returning id`, cli)
	e.exec(t, `update cheques set estado = 'rechazado' where id = $1`, cheque)
	e.exec(t, `update cheque_estados set at = '2026-10-11T15:00:00Z' where cheque_id = $1`, cheque)
	e.exec(t, `insert into account_movements (customer_id, tipo, monto, cheque_id, created_at) values ($1, 'nota_debito', 200, $2, '2026-10-11T15:00:00Z')`, cli, cheque)
	_, pend, _ = pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	if strings.Contains(pend, `"clave":"deudores-mayor"`) {
		t.Errorf("el cheque rechazado separa el listado del mayor: %s", pend)
	}
	d, err := e.s.CsvDeudores(context.Background(), time.Date(2026, 10, 31, 12, 0, 0, 0, Argentina))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(d, "Gómez") || !strings.Contains(d, "800,00") {
		t.Errorf("el cliente con el cheque rechazado no está en el listado:\n%s", d)
	}
}

// La retención de un pago del circuito B va al archivo del estudio (comité
// final, M9): emite un certificado con el CUIT de la empresa y se deposita.
// El pago se parte: lo que salió, al B; la retención, al blanco. Y el cierre
// lo avisa.
func TestLaRetencionDeUnPagoBVaAlBlanco(t *testing.T) {
	ref := "en mano"
	as := AsientosDePagoAProveedor(PagoAAsentar{Fecha: time.Date(2026, 10, 9, 15, 0, 0, 0, time.UTC), Proveedor: "Maderas", Referencia: &ref,
		Total: 1000, Retenido: 20, Medio: "efectivo", Salidas: []SalidaDePago{{Cuenta: Cuentas.Caja, Importe: 980}},
		RetenidoPorImpuesto: map[string]float64{"iibb": 15}}, CircuitoNegro)
	if len(as) != 2 {
		t.Fatalf("asientos: %+v", as)
	}
	b, blanco := as[0], as[1]
	if b.Circuito != CircuitoNegro || !b.Balancea || SaldoDeCuenta([]Asiento{b}, Cuentas.Proveedores) != 980 || SaldoDeCuenta([]Asiento{b}, Cuentas.Caja) != -980 {
		t.Errorf("lo que salió, en el B: %+v", b)
	}
	if blanco.circuito() != "blanco" || !blanco.Balancea || SaldoDeCuenta([]Asiento{blanco}, Cuentas.Proveedores) != 20 ||
		SaldoDeCuenta([]Asiento{blanco}, Cuentas.RetADepositarIibb) != -15 || SaldoDeCuenta([]Asiento{blanco}, Cuentas.RetencionesAPagar) != -5 {
		t.Errorf("la retención, en el blanco: %+v", blanco)
	}
	if as := AsientosDePagoAProveedor(PagoAAsentar{Total: 100, Medio: "efectivo"}, CircuitoNegro); len(as) != 1 || as[0].Circuito != CircuitoNegro {
		t.Errorf("sin retención, entero en el B: %+v", as)
	}

	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	prov := e.id(t, `insert into suppliers (nombre) values ('Maderas del Sur') returning id`)
	e.exec(t, `insert into supplier_payments (supplier_id, total, neto, medio, referencia, fecha, circuito) values
		($1, 1000, 980, 'efectivo', 'en mano', '2026-10-09T15:00:00Z', 'negro')`, prov)
	octubre := e.asientosDe(t, "2026-10")
	if r := SaldoDeCuenta(DelCircuito(octubre, "blanco"), Cuentas.RetencionesAPagar); r != -20 {
		t.Errorf("la retención en el archivo del estudio: %v", r)
	}
	if c := SaldoDeCuenta(DelCircuito(octubre, CircuitoNegro), Cuentas.Caja); c != -980 {
		t.Errorf("el efectivo en el B: %v", c)
	}
	_, pend, _ := pedir(t, adm, e.u+"cierre/pendientes?periodo=2026-10")
	if !strings.Contains(pend, `"clave":"retenciones-b"`) {
		t.Errorf("pendientes: %s", pend)
	}
}
