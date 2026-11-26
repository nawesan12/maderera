package reportes

import (
	"context"
	"errors"
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
	cobros, err := s.asientosDeCobro(ctx, idesde, ihasta, reparto)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, cobros...)
	cheques, err := s.asientosDeCheques(ctx, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, cheques...)
	sort.SliceStable(asientos, func(i, j int) bool { return asientos[i].Fecha.Before(asientos[j].Fecha) })
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

	cobros, err := s.asientosDeCobro(ctx, idesde, ihasta, reparto)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, cobros...)

	rs, err := s.lectura.Query(ctx, `
		SELECT f.fecha_emision, f.tipo::text, f.punto_venta, f.numero, s.nombre, f.neto, f.iva21, f.iva105, f.iva27, f.percepciones, f.total, f.exento,
		  coalesce(f.percepcion_iva, 0), coalesce(f.percepcion_iibb, 0)
		FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id
		WHERE f.fecha_emision >= $1 AND f.fecha_emision <= $2 AND f.anulada_at IS NULL ORDER BY f.fecha_emision`, desde, hasta)
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

	cheques, err := s.asientosDeCheques(ctx, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, cheques...)

	rs, err = s.lectura.Query(ctx, `
		SELECT fecha, descripcion, categoria::text, importe, medio::text, circuito::text
		FROM expenses WHERE fecha >= $1 AND fecha <= $2 ORDER BY fecha`, desde, hasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var g GastoAAsentar
		var importe jsmath.Num
		var circuito string
		if err := rs.Scan(&g.Fecha, &g.Descripcion, &g.Categoria, &importe, &g.Medio, &circuito); err != nil {
			rs.Close()
			return nil, err
		}
		g.Importe = importe.F()
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

	sort.SliceStable(asientos, func(i, j int) bool { return asientos[i].Fecha.Before(asientos[j].Fecha) })
	return asientos, nil
}

// asientosDeCheques son los cambios de estado de los cheques del período
// (cheque_estados, que anota el trigger de la base en cada cambio):
// AsientoDeCheque decide cuáles mueven cuentas.
func (s *Servicio) asientosDeCheques(ctx context.Context, idesde, ihasta time.Time) ([]Asiento, error) {
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
		  c.order_payment_id IS NOT NULL
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
		if err := rs.Scan(&c.Fecha, &c.Numero, &c.Banco, &c.Sentido, &c.Desde, &c.Hacia, &c.Importe, &c.Circuito, &vence, &pagado,
			&c.ADeudores, &c.DelMostradorEnB); err != nil {
			return nil, err
		}
		c.Diferido = c.Sentido == "entregado" && pagado != nil && ChequeDiferido(vence, *pagado)
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
		  (SELECT count(*)::int FROM goods_receipts g WHERE g.estado = 'confirmada' AND g.fecha >= $1 AND g.fecha <= $2
		     AND NOT EXISTS (SELECT 1 FROM purchase_invoices f WHERE f.receipt_id = g.id AND f.anulada_at IS NULL)),
		  (SELECT count(*)::int FROM orders o WHERE o.estado = 'cancelado' AND o.created_at <= $3 AND (`+fragmentos.FacturaViva+` OR `+fragmentos.FacturaSinBaja+`))`, desde, hasta, ihasta).
		Scan(&borradores, &cajas, &sinFactura, &facturasVivas)
	if err != nil {
		return nil, err
	}
	out := []PendienteDelCierre{}
	if borradores > 0 {
		out = append(out, PendienteDelCierre{"recepciones", "Recepciones en borrador",
			"Mercadería que entró y todavía no movió stock ni costo. El margen del mes sale incompleto.", borradores, "/admin/recepciones"})
	}
	if cajas > 0 {
		out = append(out, PendienteDelCierre{"caja", "Turnos de caja sin cerrar",
			"Efectivo sin arquear: la diferencia del mes no se puede calcular.", cajas, "/admin/caja"})
	}
	if sinFactura > 0 {
		out = append(out, PendienteDelCierre{"facturas", "Recepciones sin factura de compra",
			"Entró la mercadería pero falta el papel: ese IVA todavía no se computa como crédito.", sinFactura, "/admin/compras/facturas"})
	}
	// Una venta anulada con CAE y sin nota de crédito sigue en el libro IVA
	// ventas: su débito se debe aunque la venta ya no exista
	// (mostrador.Anular no toca el comprobante, lo avisa).
	if facturasVivas > 0 {
		out = append(out, PendienteDelCierre{"facturas-vivas", "Ventas anuladas con factura viva",
			"Falta la nota de crédito, o la baja si no tiene CAE.", facturasVivas, "/admin/facturacion?estado=" + facturacion.EstadoAnuladaViva})
	}
	// Los emitidos hasta el fin del mes (argentino) que ARCA todavía no
	// autorizó: no están en el libro ni en el CSV, y si se autorizan el mes
	// que viene salen con la fecha de ese día. Sin los borradores (no se
	// emitieron) ni los dados de baja (ya no están en invoices).
	var sinCAE int
	if err := s.pool.QueryRow(ctx, `SELECT count(*)::int FROM invoices WHERE cae IS NULL AND estado IN ('emitida', 'rechazada')
		AND fecha_emision <= $1`, ihasta).Scan(&sinCAE); err != nil {
		return nil, err
	}
	if sinCAE > 0 {
		out = append(out, PendienteDelCierre{"sin-cae", "Comprobantes sin CAE",
			"Emitidos y sin autorizar: no entran al libro IVA hasta que ARCA los autorice.", sinCAE, "/admin/facturacion"})
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
		out = append(out, PendienteDelCierre{"iva-arranque", "Saldos de IVA de arranque",
			"Falta el mes y los saldos de la última DDJJ presentada: el «A depositar» no parte de lo declarado.", 1, "/admin/arca/configuracion"})
	}
	if percibe && !vigente {
		out = append(out, PendienteDelCierre{"padron-iibb", "Padrón IIBB vencido",
			"La percepción está encendida y no hay padrón de ARBA vigente: no se le percibe a nadie.", 1, "/admin/arca"})
	}
	if apagada {
		out = append(out, PendienteDelCierre{"percepcion-apagada", "Percepción de IIBB apagada",
			"Se apagó hasta cargar el padrón de ARBA: la alícuota única ya no se usa.", 1, "/admin/arca"})
	}
	repetidos, ejemplo, err := s.gastosRepetidos(ctx, desde, hasta)
	if err != nil {
		return nil, err
	}
	if repetidos > 0 {
		out = append(out, PendienteDelCierre{"gastos-repetidos", "Gastos que parecen repetidos", ejemplo, repetidos,
			"/admin/compras/gastos?periodo=" + desde.UTC().Format("2006-01")})
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
		FROM expenses WHERE fecha >= $1 AND fecha <= $2 ORDER BY fecha, created_at`, desde, hasta)
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
	for _, d := range reparto.Deudores {
		if d < -0.01 {
			negativos++
		}
	}
	out := []PendienteDelCierre{}
	if fueraDeMes > 0 {
		out = append(out, PendienteDelCierre{"fuera-de-mes", "Autorizados fuera de su mes",
			"Se emitieron en un mes anterior y ARCA los autorizó con fecha de este.", fueraDeMes, "/admin/facturacion"})
	}
	if pagosB > 0 {
		out = append(out, PendienteDelCierre{"pagos-b", "Pagos en negro de facturas en blanco",
			"No van al archivo del estudio y la factura de compra queda abierta en Proveedores.", pagosB, "/admin/compras/pagos"})
	}
	if retencionesB > 0 {
		out = append(out, PendienteDelCierre{"retenciones-b", "Pagos del circuito B con retención",
			"La retención va al archivo del estudio y el pago al del circuito B: Proveedores queda partido.", retencionesB, "/admin/compras/pagos"})
	}
	if negativos > 0 {
		out = append(out, PendienteDelCierre{"deudores", "Clientes con Deudores en negativo",
			"Cobros o notas de crédito sin factura con CAE detrás.", negativos, "/admin/clientes"})
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
		out = append(out, PendienteDelCierre{"deudores-mayor", "El listado de deudores no da el mayor",
			"El saldo de Deudores por ventas del archivo difiere en " + formato.Moneda(dif) + " de lo que suman las cuentas.", 1,
			"/admin/cierre"})
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
	// La bolsa que solo espera facturas ya emitidas (destinos «i:») no es una
	// seña: es la cobranza de una factura que espera el CAE, y queda en
	// Anticipos hasta que ARCA la autorice. Con el aviso de la seña y su
	// consejo de IVA, el contador leía anticipos donde hubo cobranza de deuda
	// (simulación del mes, H131): van aparte, a Facturación.
	soloFacturas := func(b cobros.Bolsa) bool {
		if len(b.Destinos) == 0 {
			return false
		}
		for _, d := range b.Destinos {
			if !strings.HasPrefix(d, "i:") {
				return false
			}
		}
		return true
	}
	var delMes, deFacturas float64
	recibosDelMes, recibosDeFacturas := 0, 0
	destinos := map[string]bool{}
	clientesDeSenas := map[string]bool{}
	for _, b := range reparto.Bolsas {
		if entre(b.Fecha, idesde, ihasta) {
			if soloFacturas(b) {
				deFacturas = float64(deFacturas + b.Monto)
				recibosDeFacturas++
			} else {
				delMes = float64(delMes + b.Monto)
				recibosDelMes++
				clientesDeSenas[b.Clave] = true
			}
		}
		for _, d := range b.Destinos {
			destinos[d] = false
		}
	}
	if recibosDelMes > 0 {
		out = append(out, PendienteDelCierre{"senas-del-mes", "Señas del mes sin factura",
			formato.Moneda(jsmath.Redondear2(delMes)) + " en Anticipos de clientes. Si congelan precio, el IVA es de este mes.", recibosDelMes,
			fichaOClientes(clientesDeSenas)})
	}
	if recibosDeFacturas > 0 {
		out = append(out, PendienteDelCierre{"cobros-sin-cae", "Cobros de facturas sin CAE",
			formato.Moneda(jsmath.Redondear2(deFacturas)) + " en Anticipos de clientes hasta que ARCA autorice sus facturas.", recibosDeFacturas,
			"/admin/facturacion?estado=emitida"})
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
	var varados float64
	clientes := map[string]bool{}
	for _, b := range reparto.Bolsas {
		vivo := false
		for _, d := range b.Destinos {
			vivo = vivo || destinos[d]
		}
		if !vivo {
			varados = float64(varados + b.Monto)
			clientes[b.Clave] = true
		}
	}
	if len(clientes) > 0 {
		out = append(out, PendienteDelCierre{"anticipos-sin-aplicar", "Anticipos sin aplicar",
			formato.Moneda(jsmath.Redondear2(varados)) + " de pedidos entregados o cancelados sin factura con CAE.", len(clientes),
			fichaOClientes(clientes)})
	}

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
			if x := BancarizadoEnB(partes[id], rep); x > toleranciaAsiento {
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
		out = append(out, PendienteDelCierre{"banco-b", "Movimientos bancarios en el circuito B",
			formato.Moneda(total) + " por banco o Mercado Pago van al archivo B: el extracto no va a conciliar.", cuantos + nPagos, donde})
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
	Vendido                VendidoDelMes `json:"vendido"`
	Compras                TotalesConIva `json:"compras"`
	Gastos                 Totales       `json:"gastos"`
	RetencionesPracticadas Totales       `json:"retencionesPracticadas"`
	RetencionesSufridas    Totales       `json:"retencionesSufridas"`
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
		SELECT
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * neto), 0),
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * (iva21 + iva105 + iva27))
		    FILTER (WHERE tipo::text IN ('factura_a','factura_m','nota_credito_a','nota_debito_a')), 0),
		  coalesce(sum(CASE WHEN tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * total), 0),
		  count(*)::int
		FROM purchase_invoices WHERE fecha_emision >= $1 AND fecha_emision <= $2 AND anulada_at IS NULL`, desde, hasta).
		Scan(&cn, &ci, &ct, &r.Compras.Cantidad)
	if err != nil {
		return r, err
	}
	// Las retenciones de un pago anulado no cuentan.
	practicadas := " AND anulada_at IS NULL"
	err = s.lectura.QueryRow(ctx, `
		SELECT
		  (SELECT coalesce(sum(importe), 0) FROM expenses WHERE fecha >= $1 AND fecha <= $2),
		  (SELECT count(*)::int FROM expenses WHERE fecha >= $1 AND fecha <= $2),
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
	var total, facturado, sinCae, interno jsmath.Num
	conDescuento := s.ajuste(ctx, "ganancia_descuento", "no") == "si"
	err := s.lectura.QueryRow(ctx, `
		SELECT `+ventasNetas(conDescuento, "margenes.neto")+`,
		  `+ventasNetas(conDescuento, "margenes.neto", "o.papel = 'facturado'")+`, coalesce(sum(o.operaciones) FILTER (WHERE o.papel = 'facturado'), 0)::int,
		  `+ventasNetas(conDescuento, "margenes.neto", "o.papel = 'sin-cae'")+`, coalesce(sum(o.operaciones) FILTER (WHERE o.papel = 'sin-cae'), 0)::int,
		  `+ventasNetas(conDescuento, "margenes.neto", "o.papel = 'interno'")+`, coalesce(sum(o.operaciones) FILTER (WHERE o.papel = 'interno'), 0)::int,
		  coalesce(sum(o.operaciones) FILTER (WHERE o.papel = 'sin-factura'), 0)::int
		FROM (SELECT o.id, o.hecho, o.operaciones, o.total, o.subtotal, o.costo_envio,
		        CASE WHEN EXISTS (SELECT 1 FROM invoices f WHERE f.order_id = o.id AND f.`+conCae+` AND f.tipo::text NOT LIKE 'nota_credito%') THEN 'facturado'
		             WHEN EXISTS (SELECT 1 FROM invoices f WHERE f.order_id = o.id AND f.cae IS NULL AND f.estado IN ('emitida', 'rechazada')
		               AND f.tipo::text NOT LIKE 'nota_credito%') THEN 'sin-cae'
		             WHEN o.origen = 'mostrador' AND NOT EXISTS (SELECT 1 FROM invoices f WHERE f.order_id = o.id) THEN 'interno'
		             ELSE 'sin-factura' END AS papel
		      FROM `+hechosDeVenta+` o WHERE o.estado <> 'cancelado' AND o.fecha >= $1 AND o.fecha < $2) o `+margenesDe("o.estado <> 'cancelado' AND o.fecha >= $1 AND o.fecha < $2"),
		idesde, ihasta).Scan(&total, &facturado, &v.Facturado.Cantidad, &sinCae, &v.SinCae.Cantidad, &interno, &v.Interno.Cantidad, &v.SinFactura.Cantidad)
	v.Total = jsmath.Redondear2(total.F())
	v.Facturado.Total, v.Interno.Total = jsmath.Redondear2(facturado.F()), jsmath.Redondear2(interno.F())
	v.SinCae.Total = jsmath.Redondear2(sinCae.F())
	v.SinFactura.Total = jsmath.Redondear2(float64(float64(v.Total-v.Facturado.Total)-v.SinCae.Total) - v.Interno.Total)
	return v, err
}
