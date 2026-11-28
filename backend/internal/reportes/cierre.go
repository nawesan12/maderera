package reportes

import (
	"context"
	"errors"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
	"mjbj/internal/compras"
	"mjbj/internal/facturacion"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/reglas"
	"mjbj/internal/ventas/fragmentos"
)

// El cierre del mes (lib/dal/admin/cierre-mensual.ts): los asientos del
// período para el estudio, lo que conviene resolver antes de cerrar y los
// números del mes.
//
// **Dos cortes del mismo mes.** Lo que se guarda como día (los gastos, las
// facturas de compra, las recepciones y las retenciones sufridas, a las 0
// UTC del día del formulario: compras.LeerFecha) se corta en UTC, que es
// donde cae ese día. Lo que se guarda como instante (las facturas de venta,
// los cobros, los pagos a proveedores y sus retenciones) se corta en el mes
// argentino, igual que el libro IVA ventas: una factura del 31 a las 22 es
// de ese mes. Antes todo cortaba en UTC y esa factura se iba al cierre del
// mes siguiente, con el libro y el cierre dando IVA distinto.

// PeriodoDelCierre es el mes del cierre en UTC (el de los días); los
// instantes salen de instantes().
func PeriodoDelCierre(valor string, ahora time.Time) PeriodoMensual {
	return LeerPeriodoMensual(valor, ahora, time.UTC)
}

// instantes pasa el mes en UTC al mismo mes en hora argentina.
func instantes(desde, hasta time.Time) (time.Time, time.Time) {
	enArgentina := func(t time.Time) time.Time {
		t = t.UTC()
		return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), Argentina)
	}
	return enArgentina(desde), enArgentina(hasta)
}

// conCae: solo cuentan los comprobantes que ARCA autorizó (las anuladas
// también, porque su nota de crédito resta aparte). Los rechazados y los
// emitidos sin CAE todavía no existen para el fisco, y un CAE de
// homologación tampoco: es de prueba. Sin ambiente guardado (los de antes de
// guardarlo que no se marcaron, las pruebas que lo cargan a mano) cuenta.
const conCae = `estado <> 'borrador' AND cae IS NOT NULL AND cae_ambiente IS DISTINCT FROM 'homologacion'`

func numero(n jsmath.Num) float64 { return n.F() }

// AsientosDelPeriodo es asientosDelPeriodo: las ventas (sin borradores), los
// cobros (asientosDeCobro), las compras, los pagos a proveedores y los gastos, en orden de
// fecha. Vienen los dos circuitos, cada asiento con el suyo: el CSV del
// estudio lleva solo el blanco (CsvAsientos). Antes los gastos y pagos «en
// negro» y los cobros de ventas sin factura entraban a los asientos de este
// CUIT.
//
// La vista del cierre pide los asientos del blanco y los del B a la vez, y
// cada uno filtraba el mismo armado entero: los dos que llegan juntos con el
// mismo período comparten uno (compartido). Cada uno recibe su propia
// lista, pero los asientos y sus renglones son de los dos: nadie los
// modifica.
func (s *Servicio) AsientosDelPeriodo(ctx context.Context, desde, hasta time.Time) ([]Asiento, error) {
	clave := strconv.FormatInt(desde.UnixNano(), 10) + "|" + strconv.FormatInt(hasta.UnixNano(), 10)
	v, err := compartido(ctx, &s.asientos, clave, func(c context.Context) ([]Asiento, error) {
		_, ihasta := instantes(desde, hasta)
		reparto, err := s.repartoHasta(c, ihasta)
		if err != nil {
			return nil, err
		}
		return s.asientosDelPeriodoCon(c, desde, hasta, reparto)
	})
	if err != nil {
		return nil, err
	}
	return append([]Asiento{}, v...), nil
}

// asientosDeVentas son las facturas y notas con CAE del período (instantes).
func (s *Servicio) asientosDeVentas(ctx context.Context, idesde, ihasta time.Time) ([]Asiento, error) {
	asientos := []Asiento{}
	rs, err := s.lectura.Query(ctx, `
		SELECT fecha_emision, tipo::text, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, exento
		FROM invoices WHERE fecha_emision >= $1 AND fecha_emision <= $2 AND `+conCae+`
		ORDER BY fecha_emision`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var fecha time.Time
		var tipo, cliente string
		var pv, nro int64
		var neto, i21, i105, i27, trib, total, exento jsmath.Num
		if err := rs.Scan(&fecha, &tipo, &pv, &nro, &cliente, &neto, &i21, &i105, &i27, &trib, &total, &exento); err != nil {
			rs.Close()
			return nil, err
		}
		venta := AsientoDeVenta(VentaAAsentar{Fecha: fecha,
			Comprobante: NombreComprobante(tipo) + " " + NumeroFormateado(pv, nro), Cliente: cliente,
			Neto: neto.F(), Iva: float64(float64(i21.F()+i105.F()) + i27.F()), Tributos: trib.F(), Total: total.F(),
			EsNotaDeCredito: strings.HasPrefix(tipo, "nota_credito"), Exento: exento.F()})
		venta.Instante = true
		asientos = append(asientos, venta)
	}
	rs.Close()
	return asientos, rs.Err()
}

// asientosDeDeudores son, de los asientos del período, los que pueden tocar
// Deudores por ventas (1.1.03): las ventas, los cobros —con las
// aplicaciones de anticipo— y los cheques, en el mismo orden en que los
// junta asientosDelPeriodoCon. Con el mismo orden, SaldoDeCuenta suma lo
// mismo en el mismo orden y da el mismo centavo.
//
// Es para el control «deudores-mayor», que necesita el saldo de 1.1.03 desde
// el principio: armaba la historia entera, compras, pagos a proveedores y
// gastos incluidos, que no tocan Deudores. Sale de los mismos constructores
// que el CSV, así que el control sigue siendo independiente del reparto (la
// prueba del volumen verifica que ningún otro asiento toca 1.1.03).
func (s *Servicio) asientosDeDeudores(ctx context.Context, desde, hasta time.Time, reparto cobros.ResultadoDelReparto) ([]Asiento, error) {
	idesde, ihasta := instantes(desde, hasta)
	asientos, err := s.asientosDeVentas(ctx, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	cobros, alCobro, err := s.asientosDeCobro(ctx, idesde, ihasta, reparto)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, cobros...)
	cheques, err := s.asientosDeCheques(ctx, idesde, ihasta, reparto, alCobro)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, cheques...)
	deuda, err := s.asientosDeDeudaSinComprobante(ctx, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, deuda...)
	OrdenarAsientos(asientos)
	return asientos, nil
}

// asientosDelPeriodoCon es AsientosDelPeriodo con el reparto hasta el fin
// del período ya hecho.
func (s *Servicio) asientosDelPeriodoCon(ctx context.Context, desde, hasta time.Time, reparto cobros.ResultadoDelReparto) ([]Asiento, error) {
	idesde, ihasta := instantes(desde, hasta)
	asientos, err := s.asientosDeVentas(ctx, idesde, ihasta)
	if err != nil {
		return nil, err
	}

	cobros, alCobro, err := s.asientosDeCobro(ctx, idesde, ihasta, reparto)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, cobros...)

	rs, err := s.lectura.Query(ctx, `
		SELECT f.fecha_emision, f.tipo::text, f.punto_venta, f.numero, s.nombre, f.neto, f.iva21, f.iva105, f.iva27, f.percepciones, f.total, f.exento,
		  coalesce(f.percepcion_iva, 0), coalesce(f.percepcion_iibb, 0)
		FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id
		WHERE f.fecha_emision >= $1 AND f.fecha_emision <= $2 AND f.anulada_at IS NULL
		  -- La factura de un gasto pagado en el acto va con el asiento del
		  -- gasto (gasto e IVA contra la caja), no contra Proveedores.
		  AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.purchase_invoice_id = f.id)
		ORDER BY f.fecha_emision`, desde, hasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var fecha time.Time
		var tipo, proveedor string
		var pv, nro int64
		var neto, i21, i105, i27, perc, total, exento, percIva, percIibb jsmath.Num
		if err := rs.Scan(&fecha, &tipo, &pv, &nro, &proveedor, &neto, &i21, &i105, &i27, &perc, &total, &exento, &percIva, &percIibb); err != nil {
			rs.Close()
			return nil, err
		}
		asientos = append(asientos, AsientoDeCompra(CompraAAsentar{Fecha: fecha,
			Comprobante: compras.NombreComprobanteCompra(tipo) + " " + compras.NumeroDeCompra(pv, nro), Proveedor: proveedor,
			Neto: neto.F(), Iva: float64(float64(i21.F()+i105.F()) + i27.F()), Percepciones: perc.F(), Total: total.F(),
			DaCreditoFiscal: compras.DaCreditoFiscal(tipo), EsNotaDeCredito: strings.HasPrefix(tipo, "nota_credito"), Exento: exento.F(),
			PercepcionIva: percIva.F(), PercepcionIibb: percIibb.F()}))
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	// Cada pago con sus partes (con qué salió la plata: el cheque endosado
	// sale de Valores a depositar y el propio diferido va a Cheques
	// diferidos, no al banco) y lo retenido de cada impuesto.
	rs, err = s.lectura.Query(ctx, `
		SELECT p.fecha, s.nombre, p.referencia, p.total, p.neto, p.medio, p.anulado_at, p.circuito::text,
		  coalesce((SELECT json_agg(json_build_object('medio', x.medio, 'importe', x.importe::float8, 'sentido', c.sentido::text,
		      'fechaCheque', c.fecha_pago) ORDER BY x.id)
		    FROM supplier_payment_parts x LEFT JOIN cheques c ON c.id = x.cheque_id WHERE x.payment_id = p.id), '[]'::json),
		  coalesce((SELECT json_object_agg(r.impuesto, r.importe) FROM (SELECT impuesto::text, sum(importe)::float8 AS importe
		    FROM retenciones_practicadas WHERE payment_id = p.id GROUP BY impuesto) r), '{}'::json)
		FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id
		WHERE (p.fecha >= $1 AND p.fecha <= $2) OR (p.anulado_at >= $1 AND p.anulado_at <= $2)
		ORDER BY p.fecha`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var fecha time.Time
		var anulado *time.Time
		var proveedor, medio, circuito string
		var referencia *string
		var total, neto jsmath.Num
		var partes []struct {
			Medio       string     `json:"medio"`
			Importe     float64    `json:"importe"`
			Sentido     *string    `json:"sentido"`
			FechaCheque *time.Time `json:"fechaCheque"`
		}
		var porImpuesto map[string]float64
		if err := rs.Scan(&fecha, &proveedor, &referencia, &total, &neto, &medio, &anulado, &circuito, &partes, &porImpuesto); err != nil {
			rs.Close()
			return nil, err
		}
		var salidas []SalidaDePago
		for _, x := range partes {
			if x.Importe <= 0 {
				continue
			}
			diferido := x.FechaCheque != nil && ChequeDiferido(*x.FechaCheque, fecha)
			salidas = append(salidas, SalidaDePago{Cuenta: CuentaDeSalida(x.Medio, x.Sentido, diferido), Importe: x.Importe})
		}
		// El pago marcado «en negro» no es de este CUIT: va al CSV del
		// circuito B, no al del estudio; su retención, sí (AsientosDePagoAProveedor).
		pagos := AsientosDePagoAProveedor(PagoAAsentar{Fecha: fecha, Proveedor: proveedor, Referencia: referencia,
			Total: total.F(), Retenido: total.F() - neto.F(), Medio: medio, Salidas: salidas, RetenidoPorImpuesto: porImpuesto}, circuito)
		for _, pago := range pagos {
			pago.Instante = true
			// Como el recibo anulado: el pago queda en su mes y la anulación va
			// con su contraasiento en la fecha en que se anuló, así un mes ya
			// cerrado no cambia.
			if entre(fecha, idesde, ihasta) {
				asientos = append(asientos, pago)
			}
			if anulado != nil && entre(*anulado, idesde, ihasta) {
				anulacion := asiento(*anulado, "Anulación · "+pago.Concepto, invertir(pago.Renglones))
				anulacion.Circuito, anulacion.Instante = pago.Circuito, true
				asientos = append(asientos, anulacion)
			}
		}
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	cheques, err := s.asientosDeCheques(ctx, idesde, ihasta, reparto, alCobro)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, cheques...)

	// Los retiros de la caja que fueron al banco (el motivo lo dice): de Caja
	// a Banco. Sin esto el mayor de Caja y el de Banco no se podían conciliar
	// con los arqueos ni con el extracto (simulación del mes, H160). Los que
	// van a la caja fuerte no mueven cuentas (es la misma Caja).
	rs, err = s.lectura.Query(ctx, `SELECT m.created_at, -m.monto::float8, coalesce(m.motivo, ''), coalesce(b.name, '')
		FROM cash_movements m JOIN cash_sessions cs ON cs.id = m.session_id LEFT JOIN branches b ON b.id = cs.branch_id
		WHERE m.tipo = 'retiro' AND m.created_at >= $1 AND m.created_at <= $2 AND `+retiroAlBanco+`
		ORDER BY m.created_at`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var fecha time.Time
		var importe float64
		var motivo, sucursal string
		if err := rs.Scan(&fecha, &importe, &motivo, &sucursal); err != nil {
			rs.Close()
			return nil, err
		}
		if importe < 0 {
			importe = -importe
		}
		concepto := "Depósito de la caja"
		if sucursal != "" {
			concepto += " de " + sucursal
		}
		d := asiento(fecha, concepto, []RenglonDeAsiento{renglon(Cuentas.Banco, importe, 0), renglon(Cuentas.Caja, 0, importe)})
		d.Instante = true
		asientos = append(asientos, d)
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	caja, err := s.asientosDeCaja(ctx, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, caja...)
	costo, err := s.asientosDeCosto(ctx, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, costo...)
	inventario, err := s.asientosDeInventario(ctx, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, inventario...)

	rs, err = s.lectura.Query(ctx, `
		SELECT e.fecha, e.descripcion, e.categoria::text, e.importe, e.medio::text, e.circuito::text,
		  coalesce(f.tipo::text, ''), coalesce(f.iva21 + f.iva105 + f.iva27, 0), coalesce(f.percepciones, 0)
		FROM expenses e LEFT JOIN purchase_invoices f ON f.id = e.purchase_invoice_id AND f.anulada_at IS NULL
		WHERE e.fecha >= $1 AND e.fecha <= $2 AND e.anulado_at IS NULL ORDER BY e.fecha`, desde, hasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var g GastoAAsentar
		var importe, iva, percepciones jsmath.Num
		var circuito, tipo string
		if err := rs.Scan(&g.Fecha, &g.Descripcion, &g.Categoria, &importe, &g.Medio, &circuito, &tipo, &iva, &percepciones); err != nil {
			rs.Close()
			return nil, err
		}
		g.Importe = importe.F()
		if tipo != "" && compras.DaCreditoFiscal(tipo) {
			g.Iva, g.Percepciones = iva.F(), percepciones.F()
		}
		gasto := AsientoDeGasto(g)
		if circuito == CircuitoNegro {
			gasto.Circuito = CircuitoNegro
		}
		asientos = append(asientos, gasto)
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	mas, err := s.asientosAImputar(ctx, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, mas...)
	if mas, err = s.asientosDeAjustesDeProveedores(ctx, idesde, ihasta); err != nil {
		return nil, err
	}
	asientos = append(asientos, mas...)
	if mas, err = s.asientosDeDeudaSinComprobante(ctx, idesde, ihasta); err != nil {
		return nil, err
	}
	asientos = append(asientos, mas...)
	if mas, err = s.asientosDeLiquidaciones(ctx, idesde, ihasta); err != nil {
		return nil, err
	}
	asientos = append(asientos, mas...)

	OrdenarAsientos(asientos)
	return asientos, nil
}

// asientosAImputar son los movimientos de plata que el sistema no sabe
// contra qué van (Movimientos a imputar): el retiro de caja que no fue al
// banco ni a la caja fuerte (un pago en mano, el dueño que se lleva plata),
// que antes salía del cajón sin asiento y dejaba la Caja de los libros por
// encima del arqueo (M2S3-003), y el cheque cargado en la cartera sin un
// cobro detrás, que entraba al banco sin haber entrado nunca a Valores a
// depositar (M3S2-004).
func (s *Servicio) asientosAImputar(ctx context.Context, idesde, ihasta time.Time) ([]Asiento, error) {
	var out []Asiento
	// El ingreso «otro» (00350: el cambio que trajo alguien) es lo mismo al
	// revés: plata que entró al cajón sin saber de dónde (M3S1-005,
	// M3S3-014). Un solo asiento por movimiento: asientosDeCaja no los toma.
	rs, err := s.lectura.Query(ctx, `SELECT m.created_at, m.monto::float8, coalesce(m.motivo, ''), coalesce(b.name, '')
		FROM cash_movements m JOIN cash_sessions cs ON cs.id = m.session_id LEFT JOIN branches b ON b.id = cs.branch_id
		WHERE m.tipo IN ('ingreso', 'retiro') AND m.destino = 'otro' AND m.created_at >= $1 AND m.created_at <= $2
		ORDER BY m.created_at`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	var fecha time.Time
	var importe float64
	var motivo, sucursal string
	if _, err := pgx.ForEachRow(rs, []any{&fecha, &importe, &motivo, &sucursal}, func() error {
		ingreso := importe > 0
		importe = math.Abs(importe)
		if importe < toleranciaAsiento {
			return nil
		}
		concepto := "Retiro de la caja"
		if ingreso {
			concepto = "Ingreso a la caja"
		}
		if sucursal != "" {
			concepto += " de " + sucursal
		}
		if motivo != "" {
			concepto += " · " + motivo
		}
		renglones := []RenglonDeAsiento{renglon(Cuentas.MovimientosAImputar, importe, 0), renglon(Cuentas.Caja, 0, importe)}
		if ingreso {
			renglones = []RenglonDeAsiento{renglon(Cuentas.Caja, importe, 0), renglon(Cuentas.MovimientosAImputar, 0, importe)}
		}
		a := asiento(fecha, concepto, renglones)
		a.Instante = true
		out = append(out, a)
		return nil
	}); err != nil {
		return nil, err
	}
	rs, err = s.lectura.Query(ctx, `SELECT c.created_at, c.numero, coalesce(c.banco, ''), c.importe::float8, `+fragmentos.CircuitoDelCheque("c")+`
		FROM cheques c
		WHERE c.sentido = 'recibido' AND c.order_payment_id IS NULL AND `+cobros.ReciboDelCheque("c")+` IS NULL
		  AND c.created_at >= $1 AND c.created_at <= $2 AND c.estado::text NOT IN ('informado', 'anulado')
		  AND NOT `+cobros.ChequeNoAceptado("c")+`
		ORDER BY c.created_at`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	var numero, banco, circuito string
	if _, err := pgx.ForEachRow(rs, []any{&fecha, &numero, &banco, &importe, &circuito}, func() error {
		nombre := "Cheque N° " + numero
		if banco != "" {
			nombre += " · " + banco
		}
		a := asiento(fecha, nombre+" recibido sin cobro", []RenglonDeAsiento{renglon(Cuentas.ValoresADepositar, importe, 0),
			renglon(Cuentas.MovimientosAImputar, 0, importe)})
		a.Instante = true
		if circuito == CircuitoNegro {
			a.Circuito = CircuitoNegro
		}
		out = append(out, a)
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// AjusteDeProveedor: el movimiento `m` del libro de un proveedor no sale de
// una recepción, una factura, un pago ni un cheque: es el saldo inicial que
// vino del sistema anterior o un ajuste a mano (una bonificación, un
// redondeo). El saldo inicial tiene asiento contra Saldos iniciales y
// ajustes; el ajuste a mano, contra Ajustes con proveedores.
const AjusteDeProveedor = `(m.goods_receipt_id IS NULL AND m.purchase_invoice_id IS NULL AND m.supplier_payment_id IS NULL AND m.cheque_id IS NULL)`

// asientosDeAjustesDeProveedores son los saldos iniciales y los ajustes a
// mano del libro de cada proveedor: antes no tenían asiento y Proveedores
// (2.1.01) no daba lo que dice el libro (mes simulado, M3S1-019): el saldo
// inicial de Corralón no estaba y su pago sí, y Corralón quedaba deudor.
func (s *Servicio) asientosDeAjustesDeProveedores(ctx context.Context, idesde, ihasta time.Time) ([]Asiento, error) {
	rs, err := s.lectura.Query(ctx, `SELECT m.created_at, s.nombre, m.monto::float8, coalesce(nullif(m.detalle, ''), 'Ajuste'),
		  coalesce(m.referencia, '') = 'SALDO-INICIAL-PROV'
		FROM supplier_movements m JOIN suppliers s ON s.id = m.supplier_id
		WHERE `+AjusteDeProveedor+` AND m.created_at >= $1 AND m.created_at <= $2 AND m.monto <> 0
		ORDER BY m.created_at`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	var out []Asiento
	var fecha time.Time
	var proveedor, detalle string
	var monto float64
	var saldoInicial bool
	if _, err := pgx.ForEachRow(rs, []any{&fecha, &proveedor, &monto, &detalle, &saldoInicial}, func() error {
		// El ajuste a mano (una bonificación, un redondeo) va contra Ajustes
		// con proveedores (M3S2-028); el saldo que trajo la migración, contra
		// Saldos iniciales. Un solo asiento por movimiento.
		if !saldoInicial {
			a := AsientoDeAjusteDeProveedor(fecha, proveedor, detalle, monto)
			a.Instante = true
			out = append(out, a)
			return nil
		}
		r := []RenglonDeAsiento{renglon(Cuentas.SaldosIniciales, monto, 0), renglon(Cuentas.Proveedores, 0, monto)}
		if monto < 0 {
			r = []RenglonDeAsiento{renglon(Cuentas.Proveedores, -monto, 0), renglon(Cuentas.SaldosIniciales, 0, -monto)}
		}
		a := asiento(fecha, detalle+" · "+proveedor, r)
		a.Instante = true
		out = append(out, a)
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// asientosDeDeudaSinComprobante son, con la regla «deuda_sin_comprobante»
// en «saldo_inicial», la deuda cargada a mano en la cuenta de un cliente
// contra Saldos iniciales y ajustes (M3S3-002): el saldo del sistema
// anterior entra a Deudores del estudio y su cobro lo cancela ahí, en vez de
// sumar ventas sin factura del mes. Con «circuito_b» no hay asiento: su cobro
// va al B, como siempre.
func (s *Servicio) asientosDeDeudaSinComprobante(ctx context.Context, idesde, ihasta time.Time) ([]Asiento, error) {
	if v, err := reglas.Valor(ctx, s.pool, reglas.DeudaSinComprobante); err != nil || v != "saldo_inicial" {
		return nil, err
	}
	rs, err := s.lectura.Query(ctx, `SELECT m.created_at, coalesce(nullif(c.razon_social, ''), c.nombre), m.monto::float8,
		  coalesce(nullif(m.detalle, ''), 'Saldo de la cuenta')
		FROM account_movements m JOIN customers c ON c.id = m.customer_id
		WHERE `+cobros.DeudaSinComprobante+` AND m.created_at >= $1 AND m.created_at <= $2 ORDER BY m.created_at`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	var out []Asiento
	var fecha time.Time
	var cliente, detalle string
	var monto float64
	if _, err := pgx.ForEachRow(rs, []any{&fecha, &cliente, &monto, &detalle}, func() error {
		r := []RenglonDeAsiento{renglon(Cuentas.Deudores, monto, 0), renglon(Cuentas.SaldosIniciales, 0, monto)}
		if monto < 0 {
			r = []RenglonDeAsiento{renglon(Cuentas.SaldosIniciales, -monto, 0), renglon(Cuentas.Deudores, 0, -monto)}
		}
		a := asiento(fecha, detalle+" · "+cliente, r)
		a.Instante = true
		out = append(out, a)
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// asientosDeLiquidaciones son las liquidaciones de tarjeta del período, y la
// anulación de una, al revés, en su fecha.
func (s *Servicio) asientosDeLiquidaciones(ctx context.Context, idesde, ihasta time.Time) ([]Asiento, error) {
	rs, err := s.lectura.Query(ctx, `SELECT fecha, coalesce(referencia, ''), bruto::float8, comision::float8, circuito::text, anulada_at
		FROM liquidaciones_tarjeta WHERE (fecha >= $1 AND fecha <= $2) OR (anulada_at >= $1 AND anulada_at <= $2) ORDER BY fecha`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	var out []Asiento
	var fecha time.Time
	var anulada *time.Time
	var referencia, circuito string
	var bruto, comision float64
	if _, err := pgx.ForEachRow(rs, []any{&fecha, &referencia, &bruto, &comision, &circuito, &anulada}, func() error {
		a := AsientoDeLiquidacion(fecha, referencia, bruto, comision)
		if circuito == CircuitoNegro {
			a.Circuito = CircuitoNegro
		}
		if entre(fecha, idesde, ihasta) {
			out = append(out, a)
		}
		if anulada != nil && entre(*anulada, idesde, ihasta) {
			x := asiento(*anulada, "Anulación · "+a.Concepto, invertir(a.Renglones))
			x.Circuito, x.Instante = a.Circuito, true
			out = append(out, x)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// Liquidacion es una liquidación de tarjeta para cargar.
type Liquidacion struct {
	Fecha      time.Time
	Bruto      float64
	Comision   float64
	Referencia string
	Circuito   string
}

// CargarLiquidacion anota lo que liquidó la tarjeta.
func (s *Servicio) CargarLiquidacion(ctx context.Context, l Liquidacion, usuario string) error {
	if !(l.Bruto > 0) || l.Comision < 0 || l.Comision >= l.Bruto {
		return plataforma.Invalido(map[string]string{"bruto": "El importe tiene que ser mayor que la comisión."})
	}
	if l.Circuito != CircuitoNegro {
		l.Circuito = "blanco"
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO liquidaciones_tarjeta (fecha, bruto, comision, referencia, circuito, created_by_user_id)
		VALUES ($1, $2::numeric, $3::numeric, nullif($4, ''), $5::circuito, $6)`, l.Fecha, jsmath.Fijo2(l.Bruto), jsmath.Fijo2(l.Comision),
		l.Referencia, l.Circuito, usuario)
	return err
}

// TarjetasSinLiquidar es lo cobrado con tarjeta hasta `hasta` que todavía no
// liquidó (lo de los dos circuitos): el saldo de Tarjetas a acreditar
// (1.1.13). La venta del mostrador guarda el pago como «debito» o
// «credito», no «tarjeta»: la tarjeta del cierre decía $ 0,00 con 169.000
// en el mayor y, al liquidar, −$ 160.000 (M2S1-058). Lo que se devolvió de
// un cobro con tarjeta sale de la cuenta como en el mayor.
func (s *Servicio) TarjetasSinLiquidar(ctx context.Context, hasta time.Time) (float64, error) {
	var v float64
	err := s.lectura.QueryRow(ctx, `SELECT (
		  coalesce((SELECT sum(x.importe) FROM receipt_parts x JOIN receipts r ON r.id = x.receipt_id
		            WHERE x.medio IN ('tarjeta_debito', 'tarjeta_credito') AND r.created_at <= $1
		              AND (r.anulado_at IS NULL OR r.anulado_at > $1)), 0)
		+ coalesce((SELECT sum(CASE WHEN p.estado = 'reintegrado' AND p.updated_at <= $1 THEN 0
		                            ELSE p.monto - coalesce((SELECT sum(x.importe) FROM payment_refunds x
		                                                     WHERE x.payment_id = p.id AND x.created_at <= $1), 0) END)
		            FROM payments p WHERE p.medio IN ('tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito')
		              AND p.estado IN ('aprobado', 'reintegrado') AND p.created_at <= $1
		              AND NOT EXISTS (SELECT 1 FROM receipt_parts x WHERE x.payment_id = p.id)), 0)
		- coalesce((SELECT sum(bruto) FROM liquidaciones_tarjeta WHERE anulada_at IS NULL AND fecha <= $1), 0))::float8`, hasta).Scan(&v)
	return jsmath.Redondear2(v), err
}

// diferenciaConProveedores es, de cada proveedor, el libro sin lo recibido
// con remito y sin factura (que no tiene asiento hasta la factura) menos lo
// que Proveedores (2.1.01) tiene de él en el archivo del estudio: las
// facturas de compra que no son de un gasto, los pagos (del B, solo su
// retención), los cheques que rebotaron y los ajustes del libro.
const diferenciaConProveedores = `
SELECT s.id::text, s.nombre, (coalesce(l.m, 0) - coalesce(r.m, 0) - (coalesce(f.m, 0) - coalesce(p.m, 0) + coalesce(c.m, 0) + coalesce(a.m, 0)))::float8 AS dif
FROM suppliers s
LEFT JOIN (SELECT supplier_id, sum(monto) AS m FROM supplier_movements GROUP BY 1) l ON l.supplier_id = s.id
LEFT JOIN (SELECT m.supplier_id, sum(m.monto) AS m FROM supplier_movements m JOIN goods_receipts g ON g.id = m.goods_receipt_id
           WHERE g.estado = 'confirmada' AND ` + RecepcionSinFactura + ` GROUP BY 1) r ON r.supplier_id = s.id
LEFT JOIN (SELECT f.supplier_id, sum(CASE WHEN f.tipo::text LIKE 'nota_credito%' THEN -f.total ELSE f.total END) AS m FROM purchase_invoices f
           WHERE f.anulada_at IS NULL AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.purchase_invoice_id = f.id) GROUP BY 1) f ON f.supplier_id = s.id
LEFT JOIN (SELECT supplier_id, sum(CASE WHEN circuito = 'negro' THEN total - neto ELSE total END) AS m FROM supplier_payments
           WHERE anulado_at IS NULL GROUP BY 1) p ON p.supplier_id = s.id
LEFT JOIN (SELECT supplier_id, sum(monto) AS m FROM supplier_movements WHERE cheque_id IS NOT NULL GROUP BY 1) c ON c.supplier_id = s.id
LEFT JOIN (SELECT m.supplier_id, sum(m.monto) AS m FROM supplier_movements m WHERE ` + AjusteDeProveedor + ` GROUP BY 1) a ON a.supplier_id = s.id`

// retiroAlBanco: el retiro de caja `m` fue al banco (su destino, o el motivo
// en los de antes de la 00310). Es la misma regla de «Plata hoy».
const retiroAlBanco = RetiroAlBanco

// ingresoDelBanco: el ingreso de caja `m` vino del banco (una extracción, lo
// dice el motivo). Los demás ingresos vienen de la caja fuerte (la misma
// Caja) o devuelven un gasto o un pago anulado (que ya no se asientan).
//
// Desde la 00350 el ingreso dice de dónde viene (destino): «banco» es la
// extracción; «caja_fuerte», la misma Caja; «otro», plata que entró sin
// explicación de cuenta (asientosDeCaja la manda a Diferencias de caja).
const ingresoDelBanco = `(m.destino = 'banco' OR (m.destino IS NULL AND m.motivo ~* '(banco|extracci)'))`

// asientosDeCaja son los movimientos de las cajas que no salen de una venta,
// un cobro o un gasto (H160): la extracción del banco que entra a la caja
// (Banco a Caja) y la diferencia de cada arqueo cerrado en el período,
// contra Diferencias de caja hasta que el contador diga a qué cuenta va.
// El esperado del arqueo es el mismo que el del panel de cajas
// (caja.consultaDeTurnos).
func (s *Servicio) asientosDeCaja(ctx context.Context, idesde, ihasta time.Time) ([]Asiento, error) {
	var out []Asiento
	rs, err := s.lectura.Query(ctx, `SELECT m.created_at, m.monto::float8, coalesce(b.name, '')
		FROM cash_movements m JOIN cash_sessions cs ON cs.id = m.session_id LEFT JOIN branches b ON b.id = cs.branch_id
		WHERE m.tipo = 'ingreso' AND m.monto > 0 AND m.created_at >= $1 AND m.created_at <= $2 AND `+ingresoDelBanco+`
		ORDER BY m.created_at`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	var fecha time.Time
	var importe float64
	var sucursal string
	if _, err := pgx.ForEachRow(rs, []any{&fecha, &importe, &sucursal}, func() error {
		concepto := "Extracción del banco a la caja"
		if sucursal != "" {
			concepto += " de " + sucursal
		}
		a := asiento(fecha, concepto, []RenglonDeAsiento{renglon(Cuentas.Caja, importe, 0), renglon(Cuentas.Banco, 0, importe)})
		a.Instante = true
		out = append(out, a)
		return nil
	}); err != nil {
		return nil, err
	}
	// Lo contado, o lo corregido al abrir el turno siguiente («conté mal»,
	// 00350): el sobrante de un conteo equivocado no es plata (M2S3-002).
	// El ingreso y el retiro «otro» (00350) van a Movimientos a imputar
	// (asientosAImputar); el retiro que es un pago va como gasto
	// (mostrador.MovimientoDeCaja con categoría).
	// Lo que sale de la caja fuerte al banco (00350): la caja fuerte es la
	// misma Caja, así que el depósito es Banco a Caja, como el de un cajón.
	rs, err = s.lectura.Query(ctx, `SELECT f.created_at, f.monto::float8, coalesce(b.name, '')
		FROM caja_fuerte_movimientos f LEFT JOIN branches b ON b.id = f.branch_id
		WHERE f.tipo = 'deposito' AND f.created_at >= $1 AND f.created_at <= $2 ORDER BY f.created_at`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	if _, err := pgx.ForEachRow(rs, []any{&fecha, &importe, &sucursal}, func() error {
		concepto := "Depósito de la caja fuerte"
		if sucursal != "" {
			concepto += " de " + sucursal
		}
		a := asiento(fecha, concepto, []RenglonDeAsiento{renglon(Cuentas.Banco, importe, 0), renglon(Cuentas.Caja, 0, importe)})
		a.Instante = true
		out = append(out, a)
		return nil
	}); err != nil {
		return nil, err
	}
	rs, err = s.lectura.Query(ctx, `SELECT s.cerrada_at, coalesce(b.name, ''), (coalesce(s.contado_corregido, s.contado) - coalesce(sum(m.monto) FILTER (WHERE m.created_at <= s.cerrada_at
		  OR (m.monto > 0 AND m.declarado_at IS NOT NULL AND m.declarado_at <= s.cerrada_at)), 0))::float8
		FROM cash_sessions s LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN cash_movements m ON m.session_id = s.id
		WHERE s.estado = 'cerrada' AND s.contado IS NOT NULL AND s.cerrada_at >= $1 AND s.cerrada_at <= $2
		GROUP BY s.id, s.cerrada_at, b.name, s.contado, s.contado_corregido ORDER BY s.cerrada_at`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	var diferencia float64
	if _, err := pgx.ForEachRow(rs, []any{&fecha, &sucursal, &diferencia}, func() error {
		diferencia = jsmath.Redondear2(diferencia)
		if math.Abs(diferencia) < toleranciaAsiento {
			return nil
		}
		concepto := "Sobrante del arqueo"
		if diferencia < 0 {
			concepto = "Faltante del arqueo"
		}
		if sucursal != "" {
			concepto += " de " + sucursal
		}
		a := AsientoDeDiferenciaDeCaja(fecha, concepto, diferencia)
		a.Instante = true
		out = append(out, a)
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// asientosDeCosto son el costo de lo vendido de cada hecho de venta (H160):
// la venta en la fecha de la regla, la devolución y la cancelación en la
// suya, con el costo congelado de cada renglón.
//
// **El costo va con la venta.** El del pedido sin factura va al B en la
// fecha del hecho. El del pedido facturado espera el CAE igual que su venta:
// en el archivo del estudio el día de la factura con CAE (mes simulado,
// M2S1-060): con el costo en el mes del hecho y la venta en el del CAE, el
// estudio veía 29 millones de costo y ninguna venta. Si el pedido del B se
// factura después, el día del CAE el costo sale del B y entra al estudio.
// Ninguno cambia un mes ya cerrado: lo que se mueve, se mueve en el mes del
// CAE.
func (s *Servicio) asientosDeCosto(ctx context.Context, idesde, ihasta time.Time) ([]Asiento, error) {
	var out []Asiento
	rs, err := s.lectura.Query(ctx, `
		SELECT o.fecha, o.numero, coalesce(nullif(o.contacto_nombre, ''), ''), o.operaciones = 0 AND o.hecho <> o.id,
		  o.facturado_at IS NOT NULL AND mes_de_instante(o.facturado_at) <= mes_de_instante(o.fecha),
		  (SELECT min(i.fecha_emision) FROM invoices i WHERE i.order_id = o.id AND i.tipo::text LIKE 'factura%' AND i.estado <> 'borrador'
		     AND i.cae IS NOT NULL AND i.cae_ambiente IS DISTINCT FROM 'homologacion'),
		  coalesce(sum(`+costoDelRenglon+`) FILTER (WHERE `+costoConocido+`), 0)::float8
		FROM `+hechosDeVenta+` o JOIN `+renglonesVendidos+` oi ON oi.hecho = o.hecho
		WHERE o.fecha <= $2 AND (o.fecha >= $1 OR o.id IN (SELECT i.order_id FROM invoices i WHERE i.order_id IS NOT NULL
		  AND i.fecha_emision >= $1 AND i.fecha_emision <= $2 AND i.cae IS NOT NULL AND i.tipo::text LIKE 'factura%'))
		GROUP BY o.hecho, o.fecha, o.numero, o.contacto_nombre, o.operaciones, o.id, o.facturado_at
		ORDER BY o.fecha, o.numero`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	var fecha time.Time
	var cae *time.Time
	var numero, cliente string
	var vuelta, facturado bool
	var costo float64
	if _, err := pgx.ForEachRow(rs, []any{&fecha, &numero, &cliente, &vuelta, &facturado, &cae, &costo}, func() error {
		costo = jsmath.Redondear2(costo)
		if math.Abs(costo) < toleranciaAsiento {
			return nil
		}
		concepto := numero
		if vuelta {
			concepto = "vuelve " + numero
		}
		if cliente != "" {
			concepto += " · " + cliente
		}
		conCae := func() {
			f := mayorFecha(fecha, cae)
			if entre(f, idesde, ihasta) {
				a := AsientoDeCosto(f, concepto, costo)
				a.Instante = true
				out = append(out, a)
			}
		}
		if facturado {
			if cae != nil {
				conCae()
			}
			return nil
		}
		if entre(fecha, idesde, ihasta) {
			a := AsientoDeCosto(fecha, concepto, costo)
			a.Instante, a.Circuito = true, CircuitoNegro
			out = append(out, a)
		}
		if cae != nil {
			if f := mayorFecha(fecha, cae); entre(f, idesde, ihasta) {
				a := AsientoDeCosto(f, "pasa al archivo del estudio · "+concepto, -costo)
				a.Instante, a.Circuito = true, CircuitoNegro
				out = append(out, a)
			}
			conCae()
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// asientosDeInventario son las bajas y altas de stock sin venta del período
// (los ajustes de Stock: rotura, faltante, conteo, consumo del taller,
// reposición sin cargo, ingreso suelto), cada una al costo que se congeló al
// hacerla (M3S3-013). Sin esto, Mercaderías del archivo quedaba por encima
// del stock real con cada rotura. La reposición a un cliente es mercadería
// que se le entregó: va a Costo de mercaderías vendidas; el resto, a
// Diferencias de inventario.
func (s *Servicio) asientosDeInventario(ctx context.Context, idesde, ihasta time.Time) ([]Asiento, error) {
	var out []Asiento
	rs, err := s.lectura.Query(ctx, `
		SELECT m.created_at, m.note, p.name || ' ' || v.label, b.name, (m.qty * m.costo_unitario)::float8, m.documento_tipo = 'pedido'
		FROM inventory_movements m
		JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
		JOIN branches b ON b.id = m.branch_id
		WHERE m.costo_unitario IS NOT NULL AND m.type IN ('ingreso', 'egreso')
		  AND m.created_at >= $1 AND m.created_at <= $2
		ORDER BY m.created_at, m.id`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	var fecha time.Time
	var nota *string
	var producto, sucursal string
	var importe float64
	var reposicion *bool
	if _, err := pgx.ForEachRow(rs, []any{&fecha, &nota, &producto, &sucursal, &importe, &reposicion}, func() error {
		importe = jsmath.Redondear2(importe)
		if math.Abs(importe) < toleranciaAsiento {
			return nil
		}
		que := "Ajuste de stock"
		if nota != nil {
			if antes, _, ok := strings.Cut(*nota, " desde Stock"); ok && antes != "" {
				que = antes
			}
		}
		cuenta := Cuentas.DiferenciasDeInventario
		if reposicion != nil && *reposicion {
			cuenta = Cuentas.CostoDeVentas
		}
		a := AsientoDeInventario(fecha, que+" · "+producto+" · "+sucursal, cuenta, importe)
		a.Instante = true
		out = append(out, a)
		return nil
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// asientosDeCheques son los cambios de estado de los cheques del período
// (cheque_estados, que anota el trigger de la base en cada cambio):
// AsientoDeCheque decide cuáles mueven cuentas.
//
// **El cheque de un recibo va por el archivo por el que entró** (mes
// simulado, M2S1-012 y M3S3-001): lo que el reparto del recibo llevó al
// blanco se deposita, se acredita y rebota en el archivo del estudio, y el
// resto en el del B (cobros.ResultadoDelReparto.ChequesBlanco). El rechazo
// del blanco sale de Anticipos de clientes si el recibo había dejado ahí su
// cobro y todavía no se aplicó (Rechazos), y el del B da vuelta la venta sin
// factura que había cobrado.
//
// alCobro son los cheques del mostrador rechazados mientras su cobro
// esperaba la factura con CAE (en Anticipos o en el B): ese rechazo lo
// asienta el cobro (AsientosDelCobroAntesDeLaFactura), que da vuelta el
// anticipo. Acá iba a Deudores y el anticipo quedaba como si el cliente
// hubiera pagado (mes simulado, M2S3-005).
func (s *Servicio) asientosDeCheques(ctx context.Context, idesde, ihasta time.Time, reparto cobros.ResultadoDelReparto, alCobro map[string]bool) ([]Asiento, error) {
	// El período va sobre la fecha corrida (fragmentos.FechaDelCheque), que
	// nunca es anterior al evento: por eso el evento ya puede filtrar el
	// final del período adentro, con el índice.
	rs, err := s.lectura.Query(ctx, `
		SELECT * FROM (
		SELECT `+fragmentos.FechaDelCheque("c", "e.at")+` AS asentado, c.numero, coalesce(c.banco, ''), c.sentido::text, e.desde::text, e.hacia::text,
		  c.importe::float8, `+fragmentos.CircuitoDelCheque("c")+`,
		  c.fecha_pago, (SELECT p.fecha FROM supplier_payment_parts x JOIN supplier_payments p ON p.id = x.payment_id
		    WHERE x.cheque_id = c.id ORDER BY p.fecha LIMIT 1),
		  EXISTS (SELECT 1 FROM account_movements m WHERE m.cheque_id = c.id AND m.tipo = 'nota_debito'),
		  c.order_payment_id IS NOT NULL, c.id::text, coalesce(`+cobros.ReciboDelCheque("c")+`, '')
		FROM cheque_estados e JOIN cheques c ON c.id = e.cheque_id
		WHERE e.at <= $2 AND e.hacia IN ('acreditado', 'rechazado')) x
		WHERE x.asentado >= $1 AND x.asentado <= $2 ORDER BY x.asentado`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	out := []Asiento{}
	for rs.Next() {
		var c ChequeAAsentar
		var vence time.Time
		var pagado *time.Time
		var id, recibo string
		if err := rs.Scan(&c.Fecha, &c.Numero, &c.Banco, &c.Sentido, &c.Desde, &c.Hacia, &c.Importe, &c.Circuito, &vence, &pagado,
			&c.ADeudores, &c.DelMostradorEnB, &id, &recibo); err != nil {
			return nil, err
		}
		if alCobro[id] && c.Hacia == "rechazado" {
			continue
		}
		c.Diferido = c.Sentido == "entregado" && pagado != nil && ChequeDiferido(vence, *pagado)
		if bl, ok := reparto.ChequesBlanco[id]; ok && recibo != "" && c.Sentido == "recibido" &&
			(c.Hacia == "acreditado" && c.Desde == "depositado" || c.Hacia == "rechazado" && c.Desde != "entregado") {
			out = append(out, AsientosDeChequeDeRecibo(c, bl, reparto.Rechazos[id])...)
			continue
		}
		if a, ok := AsientoDeCheque(c); ok {
			out = append(out, a)
		}
	}
	return out, rs.Err()
}

// PendienteDelCierre es PendienteDelCierre.
type PendienteDelCierre struct {
	Clave    string `json:"clave"`
	Titulo   string `json:"titulo"`
	Detalle  string `json:"detalle"`
	Cantidad int    `json:"cantidad"`
	Donde    string `json:"donde"`
	// Casos son los de este aviso, uno por uno, con su importe y a dónde se
	// resuelve cada uno (mes simulado, M2S3-045 y M3S2-042): «Resolver»
	// llevaba a la lista entera y no se sabía cuáles eran.
	Casos []CasoDelCierre `json:"casos,omitempty"`
}

// CasoDelCierre es un caso de un aviso del cierre.
type CasoDelCierre struct {
	Nombre  string   `json:"nombre"`
	Importe *float64 `json:"importe,omitempty"`
	Donde   string   `json:"donde"`
}

func pendiente(clave, titulo, detalle string, cantidad int, donde string) PendienteDelCierre {
	return PendienteDelCierre{Clave: clave, Titulo: titulo, Detalle: detalle, Cantidad: cantidad, Donde: donde}
}

// PendientesDelCierre es pendientesDelCierre: recepciones en borrador,
// turnos de caja sin cerrar, recepciones sin factura de compra y ventas
// anuladas que siguen con su factura viva.
func (s *Servicio) PendientesDelCierre(ctx context.Context, desde, hasta time.Time) ([]PendienteDelCierre, error) {
	var borradores, cajas, sinFactura, facturasVivas int
	_, ihasta := instantes(desde, hasta)
	err := s.lectura.QueryRow(ctx, `
		SELECT
		  (SELECT count(*)::int FROM goods_receipts WHERE estado = 'borrador' AND fecha >= $1 AND fecha <= $2),
		  (SELECT count(*)::int FROM cash_sessions WHERE estado = 'abierta' AND abierta_at <= $3),
		  (SELECT count(*)::int FROM goods_receipts g WHERE g.estado = 'confirmada' AND g.fecha <= $2
		     AND `+RecepcionSinFactura+`),
		  (SELECT count(*)::int FROM orders o WHERE o.estado = 'cancelado' AND o.created_at <= $3 AND (`+fragmentos.FacturaViva+` OR `+fragmentos.FacturaSinBaja+`))`, desde, hasta, ihasta).
		Scan(&borradores, &cajas, &sinFactura, &facturasVivas)
	if err != nil {
		return nil, err
	}
	out := []PendienteDelCierre{}
	if borradores > 0 {
		out = append(out, pendiente("recepciones", "Recepciones en borrador",
			"Mercadería que entró y todavía no movió stock ni costo. El margen del mes sale incompleto.", borradores, "/admin/recepciones"))
	}
	if cajas > 0 {
		out = append(out, pendiente("caja", "Turnos de caja sin cerrar",
			"Efectivo sin arquear: la diferencia del mes no se puede calcular.", cajas, "/admin/caja"))
	}
	// Las recepciones sin factura cuentan hasta el fin del mes, también las
	// de meses anteriores: el crédito fiscal sigue sin computarse, y el
	// inicio y la lista las cuentan todas. El cierre de noviembre decía 1 y
	// el inicio 2, con la del 18/08 afuera (M2S2-043, mes 23).
	if sinFactura > 0 {
		p := pendiente("facturas", "Recepciones sin factura de compra",
			"Entró la mercadería pero falta el papel: ese IVA todavía no se computa como crédito.", sinFactura, "/admin/recepciones")
		// Una por una, con su remito y su proveedor (mes simulado, M3S2-042):
		// llevaba a las facturas de compra, donde las recepciones no están.
		rs, err := s.lectura.Query(ctx, `SELECT g.id::text, coalesce('Remito ' || nullif(g.numero_remito, ''), 'Recepción'), coalesce(s.nombre, ''),
			  coalesce((SELECT sum(i.cantidad * i.costo_unitario) FROM goods_receipt_items i WHERE i.receipt_id = g.id), 0)::float8
			FROM goods_receipts g LEFT JOIN suppliers s ON s.id = g.supplier_id
			WHERE g.estado = 'confirmada' AND g.fecha <= $1 AND `+RecepcionSinFactura+`
			ORDER BY g.fecha, g.created_at`, hasta)
		if err != nil {
			return nil, err
		}
		var id, remito, proveedor string
		var importe float64
		if _, err := pgx.ForEachRow(rs, []any{&id, &remito, &proveedor, &importe}, func() error {
			nombre := remito
			if proveedor != "" {
				nombre += " · " + proveedor
			}
			x := jsmath.Redondear2(importe)
			p.Casos = append(p.Casos, CasoDelCierre{Nombre: nombre, Importe: &x, Donde: "/admin/recepciones/" + id})
			return nil
		}); err != nil {
			return nil, err
		}
		p.Donde = dondeDeLosCasos(p)
		out = append(out, p)
	}
	// Una venta anulada con CAE y sin nota de crédito sigue en el libro IVA
	// ventas: su débito se debe aunque la venta ya no exista
	// (mostrador.Anular no toca el comprobante, lo avisa).
	if facturasVivas > 0 {
		out = append(out, pendiente("facturas-vivas", "Ventas anuladas con factura viva",
			"Falta la nota de crédito, o la baja si no tiene CAE.", facturasVivas, "/admin/facturacion?estado="+facturacion.EstadoAnuladaViva))
	}
	// Los emitidos hasta el fin del mes (argentino) que ARCA todavía no
	// autorizó: no están en el libro ni en el CSV, y si se autorizan el mes
	// que viene salen con la fecha de ese día. Sin los borradores (no se
	// emitieron) ni los dados de baja (ya no están en invoices). Por el
	// estado, como Facturación y el libro IVA: una B emitida con un CAE de
	// homologación tampoco está autorizada, y acá contaba uno menos (mes
	// simulado: 32 contra 33).
	var sinCAE int
	if err := s.pool.QueryRow(ctx, `SELECT count(*)::int FROM invoices WHERE estado IN ('emitida', 'rechazada')
		AND fecha_emision <= $1`, ihasta).Scan(&sinCAE); err != nil {
		return nil, err
	}
	if sinCAE > 0 {
		out = append(out, pendiente("sin-cae", "Comprobantes sin CAE",
			"Emitidos y sin autorizar: no entran al libro IVA hasta que ARCA los autorice.", sinCAE, "/admin/facturacion"))
	}
	// La percepción de IIBB sale del padrón de ARBA, que es mensual. Con la
	// percepción encendida y el padrón vencido no se le percibe a nadie (la
	// alícuota de «no figura» tampoco: sin padrón no figura nadie); y la
	// que estaba encendida con la alícuota única de antes se apagó con la
	// migración (00133) hasta que se cargue el padrón.
	var percibe, apagada, vigente, sinArranque bool
	if err := s.pool.QueryRow(ctx, `SELECT coalesce(bool_or(percibe_iibb), false), coalesce(bool_or(NOT percibe_iibb AND alicuota_percepcion_iibb > 0), false),
		EXISTS (SELECT 1 FROM padron_iibb_importaciones WHERE vigencia_desde <= $1::date AND vigencia_hasta >= $1::date),
		NOT coalesce(bool_or(iva_desde IS NOT NULL AND iva_desde < $2::date), false)
		FROM configuracion_fiscal`, s.ahora().In(Argentina).Format("2006-01-02"), hasta.UTC().Format("2006-01-02")).Scan(&percibe, &apagada, &vigente, &sinArranque); err != nil {
		return nil, err
	}
	// La posición de IVA sin el arranque de la última DDJJ es una cuenta que
	// no coincide con nada presentado (PosicionDeIvaDelMes).
	if sinArranque {
		out = append(out, pendiente("iva-arranque", "Saldos de IVA de arranque",
			"Falta el mes y los saldos de la última DDJJ presentada: el «A depositar» no parte de lo declarado.", 1, "/admin/arca/configuracion"))
	}
	if percibe && !vigente {
		out = append(out, pendiente("padron-iibb", "Padrón IIBB vencido",
			"La percepción está encendida y no hay padrón de ARBA vigente: no se le percibe a nadie.", 1, "/admin/arca"))
	}
	if apagada {
		out = append(out, pendiente("percepcion-apagada", "Percepción de IIBB apagada",
			"Se apagó hasta cargar el padrón de ARBA: la alícuota única ya no se usa.", 1, "/admin/arca"))
	}
	// Lo que fue a Movimientos a imputar (asientosAImputar y la devolución
	// «por otro medio»): el estudio tiene que decir a qué cuenta va.
	var aImputar int
	var montoAImputar float64
	idesde, _ := instantes(desde, hasta)
	if err := s.lectura.QueryRow(ctx, `SELECT count(*)::int, coalesce(sum(x.importe), 0)::float8 FROM (
		  SELECT -m.monto AS importe FROM cash_movements m WHERE m.tipo = 'retiro' AND m.destino = 'otro' AND m.created_at >= $1 AND m.created_at <= $2
		  UNION ALL
		  SELECT c.importe FROM cheques c WHERE c.sentido = 'recibido' AND c.order_payment_id IS NULL AND `+cobros.ReciboDelCheque("c")+` IS NULL
		    AND c.created_at >= $1 AND c.created_at <= $2 AND c.estado::text NOT IN ('informado', 'anulado')
		  AND NOT `+cobros.ChequeNoAceptado("c")+`
		  UNION ALL
		  SELECT t.importe FROM receipt_refunds t JOIN devoluciones d ON d.id = t.devolucion_id
		  WHERE d.destino = 'afuera' AND t.created_at >= $1 AND t.created_at <= $2) x`, idesde, ihasta).Scan(&aImputar, &montoAImputar); err != nil {
		return nil, err
	}
	if aImputar > 0 {
		out = append(out, pendiente("a-imputar", "Movimientos de fondos a imputar",
			formato.Moneda(jsmath.Redondear2(montoAImputar))+" en la cuenta 2.1.13: retiros de caja sin destino, cheques sin cobro y devoluciones por otro medio.",
			aImputar, "/admin/caja"))
	}
	// Los ajustes de stock que no tienen con qué costearse (ni promedio ni
	// lista de proveedor, catalogo.CostoDeAjuste): sin costo no entran en
	// asientosDeInventario y el ajuste no se veía en ningún lado (un conteo
	// del yeso RH, mes simulado). Uno por producto, con lo que movió.
	sinCosto := pendiente("ajustes-sin-costo", "Ajustes de stock sin costo", "", 0, "/admin/stock")
	rsc, err := s.lectura.Query(ctx, `
		SELECT p.id::text, p.name || ' ' || v.label, count(*)::int
		FROM inventory_movements m
		JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
		WHERE m.costo_unitario IS NULL AND m.type IN ('ingreso', 'egreso')
		  AND coalesce(m.documento_tipo, '') NOT IN ('recepcion', 'devolucion_proveedor')
		  AND m.created_at >= $1 AND m.created_at <= $2
		GROUP BY p.id, p.name, v.label ORDER BY p.name, v.label`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	var prodID, prodNombre string
	var veces int
	if _, err := pgx.ForEachRow(rsc, []any{&prodID, &prodNombre, &veces}, func() error {
		sinCosto.Cantidad += veces
		sinCosto.Casos = append(sinCosto.Casos, CasoDelCierre{Nombre: prodNombre, Donde: "/admin/productos/" + prodID})
		return nil
	}); err != nil {
		return nil, err
	}
	if sinCosto.Cantidad > 0 {
		sinCosto.Donde = dondeDeLosCasos(sinCosto)
		out = append(out, sinCosto)
	}
	repetidos, ejemplo, err := s.gastosRepetidos(ctx, desde, hasta)
	if err != nil {
		return nil, err
	}
	if repetidos > 0 {
		out = append(out, pendiente("gastos-repetidos", "Gastos que parecen repetidos", ejemplo, repetidos,
			"/admin/compras/gastos?periodo="+desde.UTC().Format("2006-01")))
	}
	mas, err := s.pendientesDeLosCircuitos(ctx, desde, hasta)
	if err != nil {
		return nil, err
	}
	return append(out, mas...), nil
}

// gastosRepetidos cuenta los pares de gastos del mes que parecen el mismo:
// misma categoría, sucursal y proveedor, y las palabras de uno contenidas en
// las del otro (sin mayúsculas, tildes, números ni palabras de relleno). Dos
// luces de EDEA de Casa Central «octubre» y «período octubre» entraron las
// dos al resultado sin que nada avisara (simulación del mes, H426). El
// ejemplo es el primer par, con sus importes.
func (s *Servicio) gastosRepetidos(ctx context.Context, desde, hasta time.Time) (int, string, error) {
	rs, err := s.lectura.Query(ctx, `SELECT categoria::text, coalesce(branch_id::text, ''), coalesce(supplier_id::text, ''), descripcion, importe::float8
		FROM expenses WHERE fecha >= $1 AND fecha <= $2 AND anulado_at IS NULL ORDER BY fecha, created_at`, desde, hasta)
	if err != nil {
		return 0, "", err
	}
	type gasto struct {
		clave, descripcion string
		palabras           map[string]bool
		importe            float64
	}
	var gastos []gasto
	var cat, suc, prov, desc string
	var imp float64
	if _, err := pgx.ForEachRow(rs, []any{&cat, &suc, &prov, &desc, &imp}, func() error {
		gastos = append(gastos, gasto{cat + "|" + suc + "|" + prov, desc, PalabrasDelGasto(desc), imp})
		return nil
	}); err != nil {
		return 0, "", err
	}
	contenidas := func(a, b map[string]bool) bool {
		for w := range a {
			if !b[w] {
				return false
			}
		}
		return true
	}
	pares, ejemplo := 0, ""
	for i := range gastos {
		for j := i + 1; j < len(gastos); j++ {
			a, b := gastos[i], gastos[j]
			if a.clave != b.clave || len(a.palabras) < 2 || len(b.palabras) < 2 {
				continue
			}
			if contenidas(a.palabras, b.palabras) || contenidas(b.palabras, a.palabras) {
				pares++
				if ejemplo == "" {
					ejemplo = "«" + a.descripcion + "» (" + formato.Moneda(a.importe) + ") y «" + b.descripcion + "» (" + formato.Moneda(b.importe) + ")."
				}
			}
		}
	}
	return pares, ejemplo, nil
}

var rellenoDelGasto = map[string]bool{"de": true, "del": true, "la": true, "el": true, "los": true, "las": true, "y": true, "a": true,
	"en": true, "por": true, "para": true, "periodo": true, "mes": true, "pago": true, "factura": true}

// PalabrasDelGasto son las palabras que identifican un gasto: en minúscula,
// sin tildes, sin números ni palabras de relleno.
func PalabrasDelGasto(texto string) map[string]bool {
	sinTildes := strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n").Replace(strings.ToLower(texto))
	out := map[string]bool{}
	for _, w := range strings.FieldsFunc(sinTildes, func(r rune) bool { return !(r >= 'a' && r <= 'z') }) {
		if len(w) > 1 && !rellenoDelGasto[w] {
			out[w] = true
		}
	}
	return out
}

// pendientesDeLosCircuitos son los que dejó la separación de los circuitos
// y la fecha de hoy al pedir el CAE:
//
//   - **Autorizados fuera de su mes**: un comprobante emitido en un mes y
//     autorizado en otro sale con la fecha del día (facturacion.alDia), y la
//     venta pasa a este mes. Es informativo: que el contador lo vea.
//   - **Pagos en negro de facturas en blanco**: el pago B no entra al CSV
//     del estudio, y la factura de compra que cancela deja Proveedores
//     abierto. Cómo se asienta lo decide el contador.
//   - **Deudores en negativo**: clientes a los que el CSV les deja Deudores
//     a favor (una nota de crédito sobre algo ya cobrado, una retención sin
//     factura detrás). El saldo de Deudores tiene que ser el de la cuenta
//     corriente facturada.
//   - **Pagos del circuito B con retención**: la retención se asienta en el
//     archivo del estudio y el resto del pago en el del B (M9); el
//     contador decide cómo cierra Proveedores de ese proveedor.
//   - **El listado de deudores no da el mayor**: la suma de las cuentas del
//     reparto contra el saldo de 1.1.03 del archivo.
func (s *Servicio) pendientesDeLosCircuitos(ctx context.Context, desde, hasta time.Time) ([]PendienteDelCierre, error) {
	idesde, ihasta := instantes(desde, hasta)
	var fueraDeMes, pagosB, retencionesB int
	if err := s.lectura.QueryRow(ctx, `
		SELECT
		  (SELECT count(*)::int FROM invoices WHERE `+conCae+` AND fecha_emision >= $1 AND fecha_emision <= $2
		     AND fecha_emision_original < $1),
		  (SELECT count(*)::int FROM supplier_payments p WHERE p.circuito = 'negro' AND p.anulado_at IS NULL
		     AND p.fecha >= $1 AND p.fecha <= $2
		     AND EXISTS (SELECT 1 FROM supplier_payment_allocations a WHERE a.payment_id = p.id)),
		  (SELECT count(*)::int FROM supplier_payments p WHERE p.circuito = 'negro' AND p.anulado_at IS NULL
		     AND p.fecha >= $1 AND p.fecha <= $2 AND p.total - p.neto > 0.005)`, idesde, ihasta).
		Scan(&fueraDeMes, &pagosB, &retencionesB); err != nil {
		return nil, err
	}
	reparto, err := s.repartoHasta(ctx, ihasta)
	if err != nil {
		return nil, err
	}
	negativos := 0
	enNegativo := map[string]float64{}
	for k, d := range reparto.Deudores {
		if d < -0.01 {
			negativos++
			enNegativo[k] = d
		}
	}
	out := []PendienteDelCierre{}
	if fueraDeMes > 0 {
		out = append(out, pendiente("fuera-de-mes", "Autorizados fuera de su mes",
			"Se emitieron en un mes anterior y ARCA los autorizó con fecha de este.", fueraDeMes, "/admin/facturacion"))
	}
	if pagosB > 0 {
		out = append(out, pendiente("pagos-b", "Pagos en negro de facturas en blanco",
			"No van al archivo del estudio y la factura de compra queda abierta en Proveedores.", pagosB, "/admin/compras/pagos"))
	}
	if retencionesB > 0 {
		out = append(out, pendiente("retenciones-b", "Pagos del circuito B con retención",
			"La retención va al archivo del estudio y el pago al del circuito B: Proveedores queda partido.", retencionesB, "/admin/compras/pagos"))
	}
	if negativos > 0 {
		p := pendiente("deudores", "Clientes con Deudores en negativo",
			"Cobros o notas de crédito sin factura con CAE detrás.", negativos, "/admin/clientes")
		if p.Casos, err = s.casosDeCuentas(ctx, enNegativo); err != nil {
			return nil, err
		}
		p.Donde = dondeDeLosCasos(p)
		out = append(out, p)
	}
	// El listado de deudores del contador sale del reparto, cuenta por
	// cuenta (CsvDeudores); el saldo de 1.1.03, de los asientos del CSV
	// desde el principio. Lo que el reparto no ve y el CSV sí (el cheque
	// rechazado que le devuelve la deuda al cliente, un asiento cargado de
	// otra forma) los separa: el contador concilia uno con otro y la
	// diferencia tiene que estar dicha (comité final, M7).
	listado := 0.0
	for _, d := range reparto.Deudores {
		listado = float64(listado + d)
	}
	//
	// El saldo de 1.1.03 hasta el fin del mes reparte hasta el mismo instante
	// que el de arriba (instantes da el mismo ihasta con cualquier desde):
	// usa el mismo reparto en vez de repetirlo, y solo los asientos que
	// pueden tocar Deudores (asientosDeDeudores).
	todos, err := s.asientosDeDeudores(ctx, time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC), hasta, reparto)
	if err != nil {
		return nil, err
	}
	if dif := redondear(SaldoDeCuenta(DelCircuito(todos, "blanco"), Cuentas.Deudores) - listado); dif > 0.01 || dif < -0.01 {
		out = append(out, pendiente("deudores-mayor", "El listado de deudores no da el mayor",
			"El saldo de Deudores por ventas del archivo difiere en "+formato.Moneda(dif)+" de lo que suman las cuentas.", 1,
			"/admin/cierre"))
	}
	// Caja, Banco y Valores a depositar del archivo del estudio nunca pueden
	// quedar en negativo: si quedan, algo entró por un archivo y salió por el
	// otro, o salió sin haber entrado (mes simulado, M3S1-002 y M3S3-001).
	// Con todo lo asentado hasta el fin del mes, en el renglón de avisos.
	fondos, err := s.asientosDelPeriodoCon(ctx, time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC), hasta, reparto)
	if err != nil {
		return nil, err
	}
	// Cada cuenta lleva a la pantalla donde se mira lo que la mueve: la caja,
	// las cobranzas del banco y la cartera de cheques. «Resolver» llevaba al
	// mismo cierre (mes 23).
	dondeSeMira := map[string]string{Cuentas.Caja: "/admin/caja", Cuentas.Banco: "/admin/pagos", Cuentas.ValoresADepositar: "/admin/cheques"}
	var enRojo []CasoDelCierre
	for _, c := range []string{Cuentas.Caja, Cuentas.Banco, Cuentas.ValoresADepositar} {
		if saldo := SaldoDeCuenta(DelCircuito(fondos, "blanco"), c); saldo < -0.009 {
			x := saldo
			enRojo = append(enRojo, CasoDelCierre{Nombre: c + " " + nombresDeCuenta[c], Importe: &x, Donde: dondeSeMira[c]})
		}
	}
	if len(enRojo) > 0 {
		p := pendiente("fondos-negativos", "Caja o Banco en negativo en el archivo del estudio",
			"Salió más de lo que entró: revisar qué cobro o depósito quedó en el otro archivo.", len(enRojo), enRojo[0].Donde)
		p.Casos = enRojo
		out = append(out, p)
	}
	// Lo mismo con los proveedores: el libro de cada uno contra lo que el
	// archivo del estudio tiene en Proveedores, proveedor por proveedor (mes
	// simulado, M3S1-019 y M3S4-006). La diferencia que queda es lo pagado en
	// negro de facturas en blanco (su propio aviso) o algo cargado de otra
	// forma; cada caso lleva a su proveedor.
	rs, err := s.lectura.Query(ctx, `SELECT * FROM (`+diferenciaConProveedores+`) x WHERE abs(x.dif) > 0.009 ORDER BY abs(x.dif) DESC`)
	if err != nil {
		return nil, err
	}
	var casos []CasoDelCierre
	var difProveedores float64
	var idProv, nombreProv string
	var dif float64
	if _, err := pgx.ForEachRow(rs, []any{&idProv, &nombreProv, &dif}, func() error {
		x := jsmath.Redondear2(dif)
		difProveedores = float64(difProveedores + x)
		casos = append(casos, CasoDelCierre{Nombre: nombreProv, Importe: &x, Donde: "/admin/proveedores/" + idProv})
		return nil
	}); err != nil {
		return nil, err
	}
	if len(casos) > 0 {
		p := pendiente("proveedores-mayor", "Los libros de proveedores no dan el mayor",
			"Proveedores del archivo difiere en "+formato.Moneda(jsmath.Redondear2(difProveedores))+" de lo que suman los libros sin los remitos sin factura.",
			len(casos), "/admin/compras/pagos")
		p.Casos = casos
		p.Donde = dondeDeLosCasos(p)
		out = append(out, p)
	}
	mas, err := s.pendientesDeAnticiposYBanco(ctx, idesde, ihasta, reparto)
	if err != nil {
		return nil, err
	}
	return append(out, mas...), nil
}

// pendientesDeAnticiposYBanco son los que el reparto no puede resolver solo
// y le tocan al estudio:
//
//   - **Señas del mes sin factura**: el anticipo cobrado en el mes que a fin
//     de mes no se aplicó. Si la seña congela precio, el hecho imponible es
//     el cobro (art. 5, inc. b, Ley de IVA) y el débito es de este mes.
//   - **Anticipos sin aplicar**: los que ya no tienen a qué aplicarse (el
//     pedido se entregó o se canceló sin factura con CAE, la factura se dio
//     de baja). Sin esto crecían en Anticipos de clientes para siempre.
//   - **Banco en el circuito B**: lo bancarizado que queda en el archivo B
//     (un recibo cuya parte B no alcanza a salir del efectivo, un pago o un
//     gasto en negro por transferencia): el extracto no va a conciliar.
func (s *Servicio) pendientesDeAnticiposYBanco(ctx context.Context, idesde, ihasta time.Time, reparto cobros.ResultadoDelReparto) ([]PendienteDelCierre, error) {
	out := []PendienteDelCierre{}
	// La bolsa que espera facturas ya emitidas (destinos «i:») no es una
	// seña: es la cobranza de una factura que espera el CAE, y queda en
	// Anticipos hasta que ARCA la autorice. Con el aviso de la seña y su
	// consejo de IVA, el contador leía anticipos donde hubo cobranza de deuda
	// (simulación del mes, H131): van aparte, a Facturación.
	//
	// Los destinos son todo lo que el cliente tenía pendiente ese día, así
	// que el cobro de una factura de un cliente con otro pedido abierto
	// también lleva «o:». Es seña solo si el recibo es de un pedido que
	// seguía abierto (su «o:» está entre los destinos) y no cobra una
	// factura; el cobro desde la ficha de la factura o de la cuenta del
	// cliente, sin pedido, es cobranza.
	recibosDelPeriodo := []string{}
	for _, b := range reparto.Bolsas {
		if entre(b.Fecha, idesde, ihasta) {
			recibosDelPeriodo = append(recibosDelPeriodo, b.Recibo)
		}
	}
	//
	// La seña de un pedido que a fin de mes ya tiene su factura emitida
	// (esperando el CAE) tampoco es «sin factura»: es el cobro de esa factura
	// (mes simulado, M2S1-059: PED-1010 con su Factura B figuraba como seña).
	pedidoDe, cobraFactura := map[string]string{}, map[string]bool{}
	pedidosDeSenas := []string{}
	for _, b := range reparto.Bolsas {
		if entre(b.Fecha, idesde, ihasta) {
			for _, d := range b.Destinos {
				if strings.HasPrefix(d, "o:") && plataforma.UUIDValido(d[2:]) {
					pedidosDeSenas = append(pedidosDeSenas, d[2:])
				}
			}
		}
	}
	facturado := map[string]bool{}
	if len(recibosDelPeriodo) > 0 {
		rs, err := s.pool.Query(ctx, `SELECT r.id::text, coalesce(r.order_id::text, ''),
			EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.receipt_id = r.id)
			FROM receipts r WHERE r.id = ANY($1::uuid[])`, recibosDelPeriodo)
		if err != nil {
			return nil, err
		}
		var id, pedido string
		var cobra bool
		if _, err := pgx.ForEachRow(rs, []any{&id, &pedido, &cobra}, func() error {
			pedidoDe[id], cobraFactura[id] = pedido, cobra
			if pedido != "" {
				pedidosDeSenas = append(pedidosDeSenas, pedido)
			}
			return nil
		}); err != nil {
			return nil, err
		}
		rs, err = s.pool.Query(ctx, `SELECT DISTINCT f.order_id::text FROM invoices f WHERE f.order_id = ANY($1::uuid[])
			AND f.tipo::text LIKE 'factura%' AND f.estado IN ('emitida', 'autorizada', 'rechazada') AND f.fecha_emision <= $2`, pedidosDeSenas, ihasta)
		if err != nil {
			return nil, err
		}
		if _, err := pgx.ForEachRow(rs, []any{&pedido}, func() error {
			facturado[pedido] = true
			return nil
		}); err != nil {
			return nil, err
		}
	}
	soloFacturas := func(b cobros.Bolsa) bool {
		// Todos los pedidos que la seña esperaba ya tienen su factura.
		if p := pedidoDe[b.Recibo]; p != "" && facturado[p] {
			return true
		}
		todos, alguno := true, false
		for _, d := range b.Destinos {
			if strings.HasPrefix(d, "o:") {
				alguno = true
				todos = todos && facturado[d[2:]]
			}
		}
		if alguno && todos {
			return true
		}
		deFactura, delPedido := false, false
		for _, d := range b.Destinos {
			deFactura = deFactura || strings.HasPrefix(d, "i:")
			delPedido = delPedido || (pedidoDe[b.Recibo] != "" && d == "o:"+pedidoDe[b.Recibo])
		}
		return deFactura && (cobraFactura[b.Recibo] || !delPedido)
	}
	var delMes, deFacturas float64
	recibosDelMes, recibosDeFacturas := 0, 0
	destinos := map[string]bool{}
	clientesDeSenas := map[string]bool{}
	montoSenas, montoFacturas := map[string]float64{}, map[string]float64{}
	for _, b := range reparto.Bolsas {
		if b.PorRegla && len(b.Destinos) == 0 {
			continue // un saldo a favor, no una seña (abajo)
		}
		if entre(b.Fecha, idesde, ihasta) {
			if soloFacturas(b) {
				deFacturas = float64(deFacturas + b.Monto)
				recibosDeFacturas++
				montoFacturas[b.Clave] = float64(montoFacturas[b.Clave] + b.Monto)
			} else {
				delMes = float64(delMes + b.Monto)
				recibosDelMes++
				clientesDeSenas[b.Clave] = true
				montoSenas[b.Clave] = float64(montoSenas[b.Clave] + b.Monto)
			}
		}
		for _, d := range b.Destinos {
			destinos[d] = false
		}
	}
	if recibosDelMes > 0 {
		p := pendiente("senas-del-mes", "Señas del mes sin factura",
			formato.Moneda(jsmath.Redondear2(delMes))+" en Anticipos de clientes. Si congelan precio, el IVA es de este mes.", recibosDelMes,
			fichaOClientes(clientesDeSenas))
		var err error
		if p.Casos, err = s.casosDeCuentas(ctx, montoSenas); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	if recibosDeFacturas > 0 {
		p := pendiente("cobros-sin-cae", "Cobros de facturas sin CAE",
			formato.Moneda(jsmath.Redondear2(deFacturas))+" en Anticipos de clientes hasta que ARCA autorice sus facturas.", recibosDeFacturas,
			"/admin/facturacion?estado=emitida")
		var err error
		if p.Casos, err = s.casosDeCuentas(ctx, montoFacturas); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	// Qué destinos siguen vivos hoy: el pedido abierto sin factura con CAE,
	// la factura que espera el CAE.
	if len(destinos) > 0 {
		lista := make([]string, 0, len(destinos))
		for d := range destinos {
			lista = append(lista, d)
		}
		// El pedido entregado cuya factura espera el CAE también sigue vivo:
		// la seña se le aplica cuando llegue. Antes el de Herrera (entregado,
		// con su B esperando) salía «sin aplicar» y el de Benítez, igual, no
		// (simulación del mes, H353).
		rs, err := s.pool.Query(ctx, `SELECT d FROM unnest($1::text[]) d WHERE
			(d LIKE 'o:%' AND EXISTS (SELECT 1 FROM orders o WHERE o.id = substr(d, 3)::uuid AND o.estado <> 'cancelado'
			  AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.cae IS NOT NULL AND i.cae_ambiente IS DISTINCT FROM 'homologacion')
			  AND (o.estado <> 'entregado' OR EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.cae IS NULL
			    AND i.estado IN ('emitida', 'rechazada') AND i.tipo::text NOT LIKE 'nota_credito%'))))
			OR (d LIKE 'i:%' AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = substr(d, 3)::uuid AND i.cae IS NULL
			  AND i.estado IN ('emitida', 'rechazada')))`, lista)
		if err != nil {
			return nil, err
		}
		for rs.Next() {
			var d string
			if err := rs.Scan(&d); err != nil {
				rs.Close()
				return nil, err
			}
			destinos[d] = true
		}
		rs.Close()
		if err := rs.Err(); err != nil {
			return nil, err
		}
	}
	var varados, aFavor float64
	clientes, conSaldo := map[string]bool{}, map[string]bool{}
	montoVarados, montoAFavor := map[string]float64{}, map[string]float64{}
	for _, b := range reparto.Bolsas {
		// Lo que la regla mandó a Anticipos sin ningún pedido (lo que sobró de
		// un cobro a cuenta) es un saldo a favor que espera la próxima
		// factura del cliente, no una seña varada.
		if b.PorRegla && len(b.Destinos) == 0 {
			aFavor = float64(aFavor + b.Monto)
			conSaldo[b.Clave] = true
			montoAFavor[b.Clave] = float64(montoAFavor[b.Clave] + b.Monto)
			continue
		}
		vivo := false
		for _, d := range b.Destinos {
			vivo = vivo || destinos[d]
		}
		if !vivo {
			varados = float64(varados + b.Monto)
			clientes[b.Clave] = true
			montoVarados[b.Clave] = float64(montoVarados[b.Clave] + b.Monto)
		}
	}
	if len(clientes) > 0 {
		p := pendiente("anticipos-sin-aplicar", "Anticipos sin aplicar",
			formato.Moneda(jsmath.Redondear2(varados))+" de pedidos entregados o cancelados sin factura con CAE.", len(clientes),
			fichaOClientes(clientes))
		var err error
		if p.Casos, err = s.casosDeCuentas(ctx, montoVarados); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	if len(conSaldo) > 0 {
		p := pendiente("saldos-a-favor", "Saldos a favor en Anticipos",
			formato.Moneda(jsmath.Redondear2(aFavor))+" cobrados de más, a imputar a la próxima factura.", len(conSaldo),
			fichaOClientes(conSaldo))
		var err error
		if p.Casos, err = s.casosDeCuentas(ctx, montoAFavor); err != nil {
			return nil, err
		}
		out = append(out, p)
	}

	mas, err := s.pendientesDeRecibosEnB(ctx, idesde, ihasta, reparto)
	if err != nil {
		return nil, err
	}
	out = append(out, mas...)

	// Lo bancarizado en el B: los recibos del período, y los pagos y gastos en
	// negro que no fueron en efectivo.
	rs, err := s.pool.Query(ctx, `SELECT r.id, p.medio::text, p.importe::float8, coalesce(ch.circuito = 'negro', false)
		FROM receipts r JOIN receipt_parts p ON p.receipt_id = r.id LEFT JOIN cheques ch ON ch.id = p.cheque_id
		WHERE r.created_at >= $1 AND r.created_at <= $2 ORDER BY r.id, p.orden`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	partes := map[string][]ParteDeRecibo{}
	var orden []string
	for rs.Next() {
		var id string
		var p ParteDeRecibo
		if err := rs.Scan(&id, &p.Medio, &p.Importe, &p.Negro); err != nil {
			rs.Close()
			return nil, err
		}
		if _, ok := partes[id]; !ok {
			orden = append(orden, id)
		}
		partes[id] = append(partes[id], p)
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}
	enBanco, cuantos := 0.0, 0
	for _, id := range orden {
		if rep, ok := reparto.Recibos[id]; ok {
			if x := BancarizadoEnB(partes[id], ConPase(rep, reparto.Pasado[id])); x > toleranciaAsiento {
				enBanco, cuantos = float64(enBanco+x), cuantos+1
			}
		}
	}
	var pagos float64
	var nPagos int
	if err := s.pool.QueryRow(ctx, `SELECT coalesce(sum(x.importe), 0)::float8, count(*)::int FROM (
		  SELECT p.total AS importe FROM supplier_payments p WHERE p.circuito = 'negro' AND p.anulado_at IS NULL
		    AND p.fecha >= $1 AND p.fecha <= $2 AND p.medio::text <> 'efectivo' AND p.medio::text NOT LIKE '%tercero%'
		  UNION ALL
		  SELECT g.importe FROM expenses g WHERE g.circuito = 'negro' AND g.fecha >= $1 AND g.fecha <= $2 AND g.medio::text <> 'efectivo'
		    AND g.anulado_at IS NULL
		) x`, idesde, ihasta).Scan(&pagos, &nPagos); err != nil {
		return nil, err
	}
	if total := jsmath.Redondear2(float64(enBanco + pagos)); cuantos+nPagos > 0 {
		// «Resolver» lleva a lo que lo genera: los cobros del mes (los recibos)
		// o, si son solo pagos y gastos, a los pagos. Antes llevaba a esta
		// misma pantalla (H378).
		donde := "/admin/pagos"
		if cuantos == 0 {
			donde = "/admin/compras/pagos"
		}
		// Cobranzas abre en el mes en curso: el cierre del mes pasado lleva
		// al mes pasado, no a uno sin esos recibos.
		if cuantos > 0 && idesde.Equal(InicioDeMes(s.ahora(), 1)) {
			donde += "?periodo=mes-pasado"
		}
		out = append(out, pendiente("banco-b", "Movimientos bancarios en el circuito B",
			formato.Moneda(total)+" por banco o Mercado Pago van al archivo B: el extracto no va a conciliar.", cuantos+nPagos, donde))
	}
	return out, nil
}

// pendientesDeRecibosEnB son los recibos del período que mandaron plata al
// circuito B y que el contador tiene que mirar, porque el reparto se fija al
// emitir el recibo y no se recalcula (docs/CONTADOR-SIN-CAE.md):
//
//   - **Cobros en el B de ventas facturadas después**: el pedido estaba
//     entregado y sin factura al cobrarse, así que el cobro fue al B como
//     venta sin factura; después se facturó, y la factura queda en el
//     archivo del estudio sin su cobro (simulación del mes, H374).
//   - **Recibos partidos entre los dos archivos**: una parte al estudio y el
//     resto al B. El recibo y la ficha no lo dicen, y la caja del estudio no
//     da con el arqueo por esa parte (H407).
//
// Cómo se corrige —mover el cobro al estudio, una nota de crédito, dejarlo—
// lo decide el contador: el cierre lo dice con el cliente a un toque.
func (s *Servicio) pendientesDeRecibosEnB(ctx context.Context, idesde, ihasta time.Time, reparto cobros.ResultadoDelReparto) ([]PendienteDelCierre, error) {
	rs, err := s.pool.Query(ctx, `SELECT r.id::text, coalesce(r.customer_id::text, ''), coalesce(r.order_id::text, ''),
		r.order_id IS NOT NULL AND EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = r.order_id AND i.tipo::text LIKE 'factura%'
		  AND i.estado NOT IN ('borrador', 'anulada') AND i.created_at > r.created_at)
		FROM receipts r WHERE r.created_at >= $1 AND r.created_at <= $2 AND r.anulado_at IS NULL`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	var facturadoDespues, partido float64
	deFacturadas, partidos := map[string]bool{}, map[string]bool{}
	montoFacturadas, montoPartidos := map[string]float64{}, map[string]float64{}
	nFacturadas, nPartidos := 0, 0
	var id, cliente, pedido string
	var despues bool
	if _, err := pgx.ForEachRow(rs, []any{&id, &cliente, &pedido, &despues}, func() error {
		rep, ok := reparto.Recibos[id]
		// Lo que pasó al archivo del estudio al facturarse el pedido ya no
		// está en el B (cobros.Pase).
		rep = ConPase(rep, reparto.Pasado[id])
		if !ok || rep.B < 0.005 {
			return nil
		}
		clave := "p:" + pedido
		if cliente != "" {
			clave = "c:" + cliente
		}
		switch {
		case despues:
			facturadoDespues = float64(facturadoDespues + rep.B)
			deFacturadas[clave] = true
			montoFacturadas[clave] = float64(montoFacturadas[clave] + rep.B)
			nFacturadas++
		case rep.Deudores+rep.Anticipo >= 0.005:
			partido = float64(partido + rep.B)
			partidos[clave] = true
			montoPartidos[clave] = float64(montoPartidos[clave] + rep.B)
			nPartidos++
		}
		return nil
	}); err != nil {
		return nil, err
	}
	out := []PendienteDelCierre{}
	if nFacturadas > 0 {
		p := pendiente("b-facturadas-despues", "Cobros en el B de ventas facturadas después",
			formato.Moneda(jsmath.Redondear2(facturadoDespues))+" en el archivo B: la factura queda en el del estudio sin su cobro.", nFacturadas,
			fichaOClientes(deFacturadas))
		var err error
		if p.Casos, err = s.casosDeCuentas(ctx, montoFacturadas); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	if nPartidos > 0 {
		p := pendiente("recibos-partidos", "Recibos partidos entre los dos archivos",
			formato.Moneda(jsmath.Redondear2(partido))+" de esos recibos van al archivo B.", nPartidos,
			fichaOClientes(partidos))
		var err error
		if p.Casos, err = s.casosDeCuentas(ctx, montoPartidos); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

// fichaOClientes es a dónde lleva «Resolver» de un aviso por cliente: con un
// solo cliente, a su ficha; si no, a la lista (H378).
func fichaOClientes(claves map[string]bool) string {
	if len(claves) == 1 {
		for c := range claves {
			if id, ok := strings.CutPrefix(c, "c:"); ok {
				return "/admin/clientes/" + id
			}
		}
	}
	return "/admin/clientes"
}

// Totales es un total con su cantidad.
type Totales struct {
	Total    float64 `json:"total"`
	Cantidad int     `json:"cantidad"`
}

// TotalesConIva son los de ventas y compras.
type TotalesConIva struct {
	Neto     float64 `json:"neto"`
	Iva      float64 `json:"iva"`
	Total    float64 `json:"total"`
	Cantidad int     `json:"cantidad"`
}

// ResumenDelMes es lo que devuelve resumenDelMes.
type ResumenDelMes struct {
	Ventas TotalesConIva `json:"ventas"`
	// Vendido: lo vendido en el mes repartido según su factura (ver
	// vendidoDelMes). Solo para la pantalla: no va a los asientos ni a
	// ningún archivo del contador.
	Vendido VendidoDelMes `json:"vendido"`
	Compras TotalesConIva `json:"compras"`
	// Gastos son los del archivo del estudio (los marcados con factura) y
	// GastosB los del circuito B, aparte (mes simulado, M2S1-055): la tarjeta
	// está al lado de lo facturado y las compras, que son del estudio.
	Gastos                 Totales `json:"gastos"`
	GastosB                Totales `json:"gastosB"`
	RetencionesPracticadas Totales `json:"retencionesPracticadas"`
	RetencionesSufridas    Totales `json:"retencionesSufridas"`
	// PercepcionesIibb: las percepciones de Ingresos Brutos que nos hicieron
	// los proveedores en sus facturas del mes, a computar en la DDJJ de IIBB.
	// Estaban en el asiento de la compra y en el CSV del libro, y no en
	// «Impuestos del período» (simulación del mes, H165).
	PercepcionesIibb Totales `json:"percepcionesIibb"`
	// PosicionIva: débito − crédito del mes, sin más (lo de antes).
	PosicionIva float64 `json:"posicionIva"`
	// Iva es la posición entera: con percepciones, retenciones y los dos
	// saldos a favor que se arrastran (PosicionDeIvaDelMes).
	Iva PosicionDeIva `json:"iva"`
	// Resultado: ventas netas − costo − gastos, contra el mes anterior (lo
	// llena la API con ResultadoDelMes).
	Resultado ResultadoComparado `json:"resultado"`
	// Cerrado: si el mes está cerrado (lo llena la API con EstadoDelMes).
	Cerrado MesCerrado `json:"cerrado"`
	// PrimerMes es el primer mes con algún movimiento («2026-09»): el
	// selector de la pantalla arranca ahí (mes simulado, M3S4-035).
	PrimerMes string `json:"primerMes"`
	// TarjetasSinLiquidar es lo cobrado con tarjeta hasta el fin del mes que
	// la tarjeta todavía no liquidó.
	TarjetasSinLiquidar float64 `json:"tarjetasSinLiquidar"`
}

// MesCerrado es si un mes está cerrado, desde cuándo y quién lo cerró.
type MesCerrado struct {
	Cerrado bool       `json:"cerrado"`
	At      *time.Time `json:"at"`
	Por     *string    `json:"por"`
}

// EstadoDelMes lee meses_cerrados.
func (s *Servicio) EstadoDelMes(ctx context.Context, mes string) (MesCerrado, error) {
	var m MesCerrado
	err := s.pool.QueryRow(ctx, `SELECT cerrado_at, cerrado_por_nombre FROM meses_cerrados WHERE mes = $1`, mes).Scan(&m.At, &m.Por)
	if errors.Is(err, pgx.ErrNoRows) {
		return MesCerrado{}, nil
	}
	m.Cerrado = err == nil
	return m, err
}

// CerrarElMes cierra o reabre un mes (meses_cerrados, 00221). Cerrado, los
// triggers de la base no dejan cargar ni cambiar nada con fecha de ese mes:
// lo que el estudio ya tiene no cambia (simulación del mes, H408). Un mes que
// todavía no terminó no se cierra.
func (s *Servicio) CerrarElMes(ctx context.Context, mes string, cerrar bool, usuario, nombre string) (MesCerrado, error) {
	if cerrar {
		hoy := s.ahora().In(Argentina).Format("2006-01")
		if mes >= hoy {
			return MesCerrado{}, plataforma.NuevoProblema(422, "Un mes se cierra cuando terminó.")
		}
		if _, err := s.pool.Exec(ctx, `INSERT INTO meses_cerrados (mes, cerrado_por, cerrado_por_nombre) VALUES ($1, $2, $3)
			ON CONFLICT (mes) DO NOTHING`, mes, usuario, nombre); err != nil {
			return MesCerrado{}, err
		}
	} else if _, err := s.pool.Exec(ctx, `DELETE FROM meses_cerrados WHERE mes = $1`, mes); err != nil {
		return MesCerrado{}, err
	}
	return s.EstadoDelMes(ctx, mes)
}

// ResumenDelMes es resumenDelMes: las notas de crédito restan, y en las
// compras solo da crédito el IVA de la A, la M y sus notas.
func (s *Servicio) ResumenDelMes(ctx context.Context, desde, hasta time.Time) (ResumenDelMes, error) {
	var r ResumenDelMes
	idesde, ihasta := instantes(desde, hasta)
	var vn, vi, vt, cn, ci, ct, g, rp, rs jsmath.Num
	err := s.lectura.QueryRow(ctx, `
		SELECT
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * neto), 0),
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * (iva21 + iva105 + iva27)), 0),
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * total), 0),
		  count(*)::int
		FROM invoices WHERE fecha_emision >= $1 AND fecha_emision <= $2 AND `+conCae, idesde, ihasta).
		Scan(&vn, &vi, &vt, &r.Ventas.Cantidad)
	if err != nil {
		return r, err
	}
	err = s.lectura.QueryRow(ctx, `
		-- El IVA es de todas las facturas de compra; el neto, el total y la
		-- cantidad, sin las de un gasto, que van en Gastos (mes simulado,
		-- M2S2-003: el neto del alquiler sumaba en Compras y en Gastos).
		SELECT
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * neto) FILTER (WHERE NOT de_gasto), 0),
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * (iva21 + iva105 + iva27))
		    FILTER (WHERE tipo::text IN ('factura_a','factura_m','nota_credito_a','nota_debito_a')), 0),
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * total) FILTER (WHERE NOT de_gasto), 0),
		  (count(*) FILTER (WHERE NOT de_gasto))::int
		FROM (SELECT f.*, EXISTS (SELECT 1 FROM expenses e WHERE e.purchase_invoice_id = f.id AND e.anulado_at IS NULL) AS de_gasto
		      FROM purchase_invoices f) purchase_invoices WHERE fecha_emision >= $1 AND fecha_emision <= $2 AND anulada_at IS NULL`, desde, hasta).
		Scan(&cn, &ci, &ct, &r.Compras.Cantidad)
	if err != nil {
		return r, err
	}
	// Las retenciones de un pago anulado no cuentan.
	practicadas := " AND anulada_at IS NULL"
	err = s.lectura.QueryRow(ctx, `
		SELECT
		  (SELECT coalesce(sum(importe), 0) FROM expenses WHERE fecha >= $1 AND fecha <= $2 AND anulado_at IS NULL AND circuito <> 'negro'),
		  (SELECT count(*)::int FROM expenses WHERE fecha >= $1 AND fecha <= $2 AND anulado_at IS NULL AND circuito <> 'negro'),
		  (SELECT coalesce(sum(importe), 0) FROM retenciones_practicadas WHERE fecha >= $3 AND fecha <= $4`+practicadas+`),
		  (SELECT count(*)::int FROM retenciones_practicadas WHERE fecha >= $3 AND fecha <= $4`+practicadas+`),
		  (SELECT coalesce(sum(importe), 0) FROM retenciones_sufridas WHERE anulada_at IS NULL AND fecha >= $1 AND fecha <= $2),
		  (SELECT count(*)::int FROM retenciones_sufridas WHERE anulada_at IS NULL AND fecha >= $1 AND fecha <= $2)`, desde, hasta, idesde, ihasta).
		Scan(&g, &r.Gastos.Cantidad, &rp, &r.RetencionesPracticadas.Cantidad, &rs, &r.RetencionesSufridas.Cantidad)
	if err != nil {
		return r, err
	}
	var pi jsmath.Num
	if err := s.lectura.QueryRow(ctx, `SELECT coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * percepcion_iibb), 0),
		count(*) FILTER (WHERE coalesce(percepcion_iibb, 0) <> 0)::int
		FROM purchase_invoices WHERE fecha_emision >= $1 AND fecha_emision <= $2 AND anulada_at IS NULL`, desde, hasta).
		Scan(&pi, &r.PercepcionesIibb.Cantidad); err != nil {
		return r, err
	}
	r.PercepcionesIibb.Total = numero(pi)
	var gb jsmath.Num
	if err := s.lectura.QueryRow(ctx, `SELECT coalesce(sum(importe), 0), count(*)::int FROM expenses
		WHERE fecha >= $1 AND fecha <= $2 AND anulado_at IS NULL AND circuito = 'negro'`, desde, hasta).Scan(&gb, &r.GastosB.Cantidad); err != nil {
		return r, err
	}
	r.GastosB.Total = numero(gb)
	var primero *time.Time
	if err := s.lectura.QueryRow(ctx, `SELECT least((SELECT min(created_at) FROM orders), (SELECT min(fecha_emision) FROM invoices),
		(SELECT min(fecha::timestamptz) FROM expenses), (SELECT min(fecha_emision::timestamptz) FROM purchase_invoices),
		(SELECT min(created_at) FROM receipts))`).Scan(&primero); err != nil {
		return r, err
	}
	if primero != nil {
		r.PrimerMes = primero.In(Argentina).Format("2006-01")
	}
	if r.TarjetasSinLiquidar, err = s.TarjetasSinLiquidar(ctx, ihasta); err != nil {
		return r, err
	}
	r.Ventas.Neto, r.Ventas.Iva, r.Ventas.Total = numero(vn), numero(vi), numero(vt)
	r.Compras.Neto, r.Compras.Iva, r.Compras.Total = numero(cn), numero(ci), numero(ct)
	r.Gastos.Total, r.RetencionesPracticadas.Total, r.RetencionesSufridas.Total = numero(g), numero(rp), numero(rs)
	r.PosicionIva = r.Ventas.Iva - r.Compras.Iva
	r.Iva, err = s.PosicionDeIvaDelMes(ctx, desde, hasta)
	if err != nil {
		return r, err
	}
	inicio := time.Date(desde.Year(), desde.Month(), 1, 0, 0, 0, 0, Argentina)
	r.Vendido, err = s.vendidoDelMes(ctx, inicio, inicio.AddDate(0, 1, 0))
	return r, err
}

// VendidoDelMes es el «Vendido sin IVA» del resultado del Cierre partido en
// tres, que suman exacto:
//
//   - Facturado: los pedidos con alguna factura con CAE que no es nota de
//     crédito, sea del mes que sea (el de octubre facturado en noviembre no
//     es «sin factura»).
//   - Interno: las ventas del mostrador sin ningún comprobante, el ticket
//     interno que se elige a propósito.
//   - SinFactura: el resto, lo que tendría que estar facturado y no lo
//     está (los pedidos web y de presupuesto, y los del mostrador cuyo
//     comprobante no llegó a tener CAE).
//
// **La misma base que el resultado.** Antes «sin factura» salía de la
// cabecera del pedido (con envío y descuento) y «Vendido sin IVA» de los
// renglones: en la misma pantalla, vendido $9M, facturado $6,5M y sin
// factura $2,7M no cerraban, y el sin factura mezclaba el ticket interno
// con lo que se olvidó facturar. Ahora las tres partes salen de los mismos
// renglones (ventasNetas, con la misma regla del descuento) y SinFactura es
// la resta, así el redondeo no deja un centavo suelto. «Facturado neto», la
// tarjeta de los comprobantes, sigue siendo lo fiscal: se corta por la
// fecha de la factura y lleva el envío.
//
// **Sin CAE no es sin factura.** Lo que tiene su comprobante numerado y
// espera el CAE (emitido o rechazado) va aparte, como SinCae: el contador
// leía «sin factura $ 42 M» como ventas en negro cuando las 133 tenían
// factura (simulación del mes, H422).
type VendidoDelMes struct {
	Total      float64 `json:"total"`
	Facturado  Totales `json:"facturado"`
	SinCae     Totales `json:"sinCae"`
	Interno    Totales `json:"interno"`
	SinFactura Totales `json:"sinFactura"`
}

func (s *Servicio) vendidoDelMes(ctx context.Context, idesde, ihasta time.Time) (VendidoDelMes, error) {
	var v VendidoDelMes
	var total, sinCosto, facturado, sinCae, interno jsmath.Num
	conDescuento := s.ajuste(ctx, "ganancia_descuento", "no") == "si"
	// Sobre lo vendido con costo: lo vendido sin costo va aparte en el
	// resultado, y así las partes suman la línea de arriba (mes simulado,
	// M3S1-020).
	const neto = "coalesce(margenes.neto_costeado, 0)"
	err := s.lectura.QueryRow(ctx, `
		SELECT `+ventasNetas(conDescuento, "coalesce(margenes.neto, 0)")+`,
		  `+ventasNetas(conDescuento, "(coalesce(margenes.neto, 0) - "+neto+")")+`,
		  `+ventasNetas(conDescuento, neto, "o.papel = 'facturado'")+`, coalesce(sum(o.operaciones) FILTER (WHERE o.papel = 'facturado'), 0)::int,
		  `+ventasNetas(conDescuento, neto, "o.papel = 'sin-cae'")+`, coalesce(sum(o.operaciones) FILTER (WHERE o.papel = 'sin-cae'), 0)::int,
		  `+ventasNetas(conDescuento, neto, "o.papel = 'interno'")+`, coalesce(sum(o.operaciones) FILTER (WHERE o.papel = 'interno'), 0)::int,
		  coalesce(sum(o.operaciones) FILTER (WHERE o.papel = 'sin-factura'), 0)::int
		FROM (SELECT o.id, o.hecho, o.operaciones, o.total, o.subtotal, o.costo_envio,
		        CASE WHEN EXISTS (SELECT 1 FROM invoices f WHERE f.order_id = o.id AND f.`+conCae+` AND f.tipo::text NOT LIKE 'nota_credito%') THEN 'facturado'
		             WHEN EXISTS (SELECT 1 FROM invoices f WHERE f.order_id = o.id AND f.cae IS NULL AND f.estado IN ('emitida', 'rechazada')
		               AND f.tipo::text NOT LIKE 'nota_credito%') THEN 'sin-cae'
		             WHEN o.origen = 'mostrador' AND NOT EXISTS (SELECT 1 FROM invoices f WHERE f.order_id = o.id) THEN 'interno'
		             ELSE 'sin-factura' END AS papel
		      FROM `+hechosDeVenta+` o WHERE o.fecha >= $1 AND o.fecha < $2) o `+margenesDe("o.fecha >= $1 AND o.fecha < $2"),
		idesde, ihasta).Scan(&total, &sinCosto, &facturado, &v.Facturado.Cantidad, &sinCae, &v.SinCae.Cantidad, &interno, &v.Interno.Cantidad, &v.SinFactura.Cantidad)
	if err != nil {
		return v, err
	}
	m, err := s.facturasManuales(ctx, idesde, ihasta)
	if err != nil {
		return v, err
	}
	v.Facturado.Cantidad += m.conCae.Cantidad
	v.SinCae.Cantidad += m.sinCae.Cantidad
	// El total con el mismo redondeo que el resultado (ResultadoEntre):
	// todo lo vendido redondeado menos lo sin costo redondeado. Sumar solo lo
	// costeado y redondear una vez daba un centavo distinto del «Vendido sin
	// IVA» de arriba (mes 23).
	v.Total = jsmath.Redondear2(jsmath.Redondear2(float64(float64(total.F()+m.conCae.Total)+m.sinCae.Total)) - jsmath.Redondear2(sinCosto.F()))
	v.Facturado.Total, v.Interno.Total = jsmath.Redondear2(facturado.F()+m.conCae.Total), jsmath.Redondear2(interno.F())
	v.SinCae.Total = jsmath.Redondear2(sinCae.F() + m.sinCae.Total)
	v.SinFactura.Total = jsmath.Redondear2(float64(float64(v.Total-v.Facturado.Total)-v.SinCae.Total) - v.Interno.Total)
	return v, nil
}

// manuales son las facturas y notas hechas a mano, sin pedido, de un lapso.
type manuales struct{ conCae, sinCae Totales }

// facturasManuales es lo facturado a mano, sin pedido (un servicio, un
// flete suelto), sin IVA, en el lapso en que se emitió: es venta aunque no
// haya pedido (mes simulado, M2S1-009). Las notas de crédito restan; las
// notas de una factura con pedido no, que ya restan con su devolución.
func (s *Servicio) facturasManuales(ctx context.Context, idesde, ihasta time.Time) (manuales, error) {
	var m manuales
	var con, sin jsmath.Num
	err := s.lectura.QueryRow(ctx, `
		SELECT coalesce(sum(x.neto) FILTER (WHERE x.cae), 0), (count(*) FILTER (WHERE x.cae))::int,
		       coalesce(sum(x.neto) FILTER (WHERE NOT x.cae), 0), (count(*) FILTER (WHERE NOT x.cae))::int
		FROM (SELECT CASE WHEN i.tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * (i.neto + i.exento) AS neto,
		        i.cae IS NOT NULL AND i.cae_ambiente IS DISTINCT FROM 'homologacion' AS cae
		      FROM invoices i
		      WHERE i.order_id IS NULL AND i.estado IN ('emitida', 'autorizada', 'rechazada', 'anulada')
		        AND least(i.created_at, i.fecha_emision) >= $1 AND least(i.created_at, i.fecha_emision) < $2
		        AND NOT EXISTS (SELECT 1 FROM invoices o WHERE o.id = i.comprobante_origen_id AND o.order_id IS NOT NULL)) x`, idesde, ihasta).
		Scan(&con, &m.conCae.Cantidad, &sin, &m.sinCae.Cantidad)
	m.conCae.Total, m.sinCae.Total = jsmath.Redondear2(con.F()), jsmath.Redondear2(sin.F())
	return m, err
}

// casosDeCuentas son las cuentas del reparto (c:cliente, p:pedido, f:factura)
// con su importe, por nombre y con el enlace a su ficha.
func (s *Servicio) casosDeCuentas(ctx context.Context, montos map[string]float64) ([]CasoDelCierre, error) {
	if len(montos) == 0 {
		return nil, nil
	}
	ids := map[string][]string{}
	for k := range montos {
		if len(k) > 2 {
			ids[k[:2]] = append(ids[k[:2]], k[2:])
		}
	}
	nombres := map[string]string{}
	leer := func(prefijo, sql string) error {
		if len(ids[prefijo]) == 0 {
			return nil
		}
		rs, err := s.lectura.Query(ctx, sql, ids[prefijo])
		if err != nil {
			return err
		}
		var id, nombre string
		_, err = pgx.ForEachRow(rs, []any{&id, &nombre}, func() error {
			nombres[prefijo+id] = nombre
			return nil
		})
		return err
	}
	if err := leer("c:", `SELECT id::text, coalesce(nullif(razon_social, ''), nombre) FROM customers WHERE id::text = ANY($1)`); err != nil {
		return nil, err
	}
	if err := leer("p:", `SELECT id::text, numero || coalesce(' · ' || nullif(contacto_nombre, ''), '') FROM orders WHERE id::text = ANY($1)`); err != nil {
		return nil, err
	}
	if err := leer("f:", `SELECT id::text, receptor_nombre FROM invoices WHERE id::text = ANY($1)`); err != nil {
		return nil, err
	}
	out := make([]CasoDelCierre, 0, len(montos))
	for k, m := range montos {
		donde := "/admin/clientes"
		switch k[:2] {
		case "c:":
			donde = "/admin/clientes/" + k[2:]
		case "p:":
			donde = "/admin/pedidos/" + k[2:]
		case "f:":
			donde = "/admin/facturacion/" + k[2:]
		}
		x := jsmath.Redondear2(m)
		nombre := nombres[k]
		if nombre == "" {
			nombre = "Sin nombre"
		}
		out = append(out, CasoDelCierre{Nombre: nombre, Importe: &x, Donde: donde})
	}
	sort.Slice(out, func(i, j int) bool {
		if math.Abs(*out[i].Importe) != math.Abs(*out[j].Importe) {
			return math.Abs(*out[i].Importe) > math.Abs(*out[j].Importe)
		}
		return out[i].Nombre < out[j].Nombre
	})
	return out, nil
}

// dondeDeLosCasos: con un solo caso, «Resolver» va directo a él.
func dondeDeLosCasos(p PendienteDelCierre) string {
	if len(p.Casos) == 1 {
		return p.Casos[0].Donde
	}
	return p.Donde
}
