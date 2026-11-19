package reportes

import (
	"context"
	"sort"
	"strings"
	"time"

	"mjbj/internal/cobros"
	"mjbj/internal/compras"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
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
// emitidos sin CAE todavía no existen para el fisco.
const conCae = `estado <> 'borrador' AND cae IS NOT NULL`

func numero(n jsmath.Num) float64 { return n.F() }

// AsientosDelPeriodo es asientosDelPeriodo: las ventas (sin borradores), los
// cobros (asientosDeCobro), las compras, los pagos a proveedores y los gastos, en orden de
// fecha. Vienen los dos circuitos, cada asiento con el suyo: el CSV del
// estudio lleva solo el blanco (CsvAsientos). Antes los gastos y pagos «en
// negro» y los cobros de ventas sin factura entraban a los asientos de este
// CUIT.
func (s *Servicio) AsientosDelPeriodo(ctx context.Context, desde, hasta time.Time) ([]Asiento, error) {
	asientos := []Asiento{}
	idesde, ihasta := instantes(desde, hasta)

	rs, err := s.pool.Query(ctx, `
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
		asientos = append(asientos, AsientoDeVenta(VentaAAsentar{Fecha: fecha,
			Comprobante: NombreComprobante(tipo) + " " + NumeroFormateado(pv, nro), Cliente: cliente,
			Neto: neto.F(), Iva: float64(float64(i21.F()+i105.F()) + i27.F()), Tributos: trib.F(), Total: total.F(),
			EsNotaDeCredito: strings.HasPrefix(tipo, "nota_credito"), Exento: exento.F()}))
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	cobros, err := s.asientosDeCobro(ctx, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	asientos = append(asientos, cobros...)

	rs, err = s.pool.Query(ctx, `
		SELECT f.fecha_emision, f.tipo::text, f.punto_venta, f.numero, s.nombre, f.neto, f.iva21, f.iva105, f.iva27, f.percepciones, f.total, f.exento
		FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id
		WHERE f.fecha_emision >= $1 AND f.fecha_emision <= $2 AND f.anulada_at IS NULL ORDER BY f.fecha_emision`, desde, hasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var fecha time.Time
		var tipo, proveedor string
		var pv, nro int64
		var neto, i21, i105, i27, perc, total, exento jsmath.Num
		if err := rs.Scan(&fecha, &tipo, &pv, &nro, &proveedor, &neto, &i21, &i105, &i27, &perc, &total, &exento); err != nil {
			rs.Close()
			return nil, err
		}
		asientos = append(asientos, AsientoDeCompra(CompraAAsentar{Fecha: fecha,
			Comprobante: compras.NombreComprobanteCompra(tipo) + " " + compras.NumeroDeCompra(pv, nro), Proveedor: proveedor,
			Neto: neto.F(), Iva: float64(float64(i21.F()+i105.F()) + i27.F()), Percepciones: perc.F(), Total: total.F(),
			DaCreditoFiscal: compras.DaCreditoFiscal(tipo), EsNotaDeCredito: strings.HasPrefix(tipo, "nota_credito"), Exento: exento.F()}))
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	rs, err = s.pool.Query(ctx, `
		SELECT p.fecha, s.nombre, p.referencia, p.total, p.neto, p.medio, p.anulado_at, p.circuito::text
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
		if err := rs.Scan(&fecha, &proveedor, &referencia, &total, &neto, &medio, &anulado, &circuito); err != nil {
			rs.Close()
			return nil, err
		}
		pago := AsientoDePagoAProveedor(PagoAAsentar{Fecha: fecha, Proveedor: proveedor, Referencia: referencia,
			Total: total.F(), Retenido: total.F() - neto.F(), Medio: medio})
		// El pago marcado «en negro» no es de este CUIT: va al CSV del
		// circuito B, no al del estudio.
		if circuito == CircuitoNegro {
			pago.Circuito = CircuitoNegro
		}
		// Como el recibo anulado: el pago queda en su mes y la anulación va
		// con su contraasiento en la fecha en que se anuló, así un mes ya
		// cerrado no cambia.
		if entre(fecha, idesde, ihasta) {
			asientos = append(asientos, pago)
		}
		if anulado != nil && entre(*anulado, idesde, ihasta) {
			anulacion := asiento(*anulado, "Anulación · "+pago.Concepto, invertir(pago.Renglones))
			anulacion.Circuito = pago.Circuito
			asientos = append(asientos, anulacion)
		}
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	rs, err = s.pool.Query(ctx, `
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

// PendienteDelCierre es PendienteDelCierre.
type PendienteDelCierre struct {
	Clave    string `json:"clave"`
	Titulo   string `json:"titulo"`
	Detalle  string `json:"detalle"`
	Cantidad int    `json:"cantidad"`
	Donde    string `json:"donde"`
}

// PendientesDelCierre es pendientesDelCierre: recepciones en borrador,
// turnos de caja sin cerrar y recepciones sin factura de compra.
func (s *Servicio) PendientesDelCierre(ctx context.Context, desde, hasta time.Time) ([]PendienteDelCierre, error) {
	var borradores, cajas, sinFactura int
	_, ihasta := instantes(desde, hasta)
	err := s.pool.QueryRow(ctx, `
		SELECT
		  (SELECT count(*)::int FROM goods_receipts WHERE estado = 'borrador' AND fecha >= $1 AND fecha <= $2),
		  (SELECT count(*)::int FROM cash_sessions WHERE estado = 'abierta' AND abierta_at <= $3),
		  (SELECT count(*)::int FROM goods_receipts g WHERE g.estado = 'confirmada' AND g.fecha >= $1 AND g.fecha <= $2
		     AND NOT EXISTS (SELECT 1 FROM purchase_invoices f WHERE f.receipt_id = g.id AND f.anulada_at IS NULL))`, desde, hasta, ihasta).
		Scan(&borradores, &cajas, &sinFactura)
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
	mas, err := s.pendientesDeLosCircuitos(ctx, desde, hasta)
	if err != nil {
		return nil, err
	}
	return append(out, mas...), nil
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
func (s *Servicio) pendientesDeLosCircuitos(ctx context.Context, desde, hasta time.Time) ([]PendienteDelCierre, error) {
	idesde, ihasta := instantes(desde, hasta)
	var fueraDeMes, pagosB int
	if err := s.pool.QueryRow(ctx, `
		SELECT
		  (SELECT count(*)::int FROM invoices WHERE `+conCae+` AND fecha_emision >= $1 AND fecha_emision <= $2
		     AND fecha_emision_original < $1),
		  (SELECT count(*)::int FROM supplier_payments p WHERE p.circuito = 'negro' AND p.anulado_at IS NULL
		     AND p.fecha >= $1 AND p.fecha <= $2
		     AND EXISTS (SELECT 1 FROM supplier_payment_allocations a WHERE a.payment_id = p.id))`, idesde, ihasta).
		Scan(&fueraDeMes, &pagosB); err != nil {
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
	if negativos > 0 {
		out = append(out, PendienteDelCierre{"deudores", "Clientes con Deudores en negativo",
			"Cobros o notas de crédito sin factura con CAE detrás.", negativos, "/admin/clientes"})
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
	var delMes float64
	recibosDelMes := 0
	destinos := map[string]bool{}
	for _, b := range reparto.Bolsas {
		if entre(b.Fecha, idesde, ihasta) {
			delMes = float64(delMes + b.Monto)
			recibosDelMes++
		}
		for _, d := range b.Destinos {
			destinos[d] = false
		}
	}
	if recibosDelMes > 0 {
		out = append(out, PendienteDelCierre{"senas-del-mes", "Señas del mes sin factura",
			formato.Moneda(jsmath.Redondear2(delMes)) + " en Anticipos de clientes. Si congelan precio, el IVA es de este mes.", recibosDelMes, "/admin/clientes"})
	}
	// Qué destinos siguen vivos hoy: el pedido abierto sin factura con CAE,
	// la factura que espera el CAE.
	if len(destinos) > 0 {
		lista := make([]string, 0, len(destinos))
		for d := range destinos {
			lista = append(lista, d)
		}
		rs, err := s.pool.Query(ctx, `SELECT d FROM unnest($1::text[]) d WHERE
			(d LIKE 'o:%' AND EXISTS (SELECT 1 FROM orders o WHERE o.id = substr(d, 3)::uuid AND o.estado NOT IN ('cancelado', 'entregado')
			  AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.cae IS NOT NULL)))
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
			formato.Moneda(jsmath.Redondear2(varados)) + " de pedidos entregados o cancelados sin factura con CAE.", len(clientes), "/admin/clientes"})
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
		out = append(out, PendienteDelCierre{"banco-b", "Movimientos bancarios en el circuito B",
			formato.Moneda(total) + " por banco o Mercado Pago van al archivo B: el extracto no va a conciliar.", cuantos + nPagos, "/admin/cierre"})
	}
	return out, nil
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
	Ventas                 TotalesConIva `json:"ventas"`
	Compras                TotalesConIva `json:"compras"`
	Gastos                 Totales       `json:"gastos"`
	RetencionesPracticadas Totales       `json:"retencionesPracticadas"`
	RetencionesSufridas    Totales       `json:"retencionesSufridas"`
	// PosicionIva: positivo, hay que depositar; negativo, saldo a favor.
	PosicionIva float64 `json:"posicionIva"`
	// Resultado: ventas netas − costo − gastos, contra el mes anterior (lo
	// llena la API con ResultadoDelMes).
	Resultado ResultadoComparado `json:"resultado"`
}

// ResumenDelMes es resumenDelMes: las notas de crédito restan, y en las
// compras solo da crédito el IVA de la A, la M y sus notas.
func (s *Servicio) ResumenDelMes(ctx context.Context, desde, hasta time.Time) (ResumenDelMes, error) {
	var r ResumenDelMes
	idesde, ihasta := instantes(desde, hasta)
	var vn, vi, vt, cn, ci, ct, g, rp, rs jsmath.Num
	err := s.pool.QueryRow(ctx, `
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
	err = s.pool.QueryRow(ctx, `
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
	err = s.pool.QueryRow(ctx, `
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
	r.Ventas.Neto, r.Ventas.Iva, r.Ventas.Total = numero(vn), numero(vi), numero(vt)
	r.Compras.Neto, r.Compras.Iva, r.Compras.Total = numero(cn), numero(ci), numero(ct)
	r.Gastos.Total, r.RetencionesPracticadas.Total, r.RetencionesSufridas.Total = numero(g), numero(rp), numero(rs)
	r.PosicionIva = r.Ventas.Iva - r.Compras.Iva
	return r, nil
}
