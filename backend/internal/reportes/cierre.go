package reportes

import (
	"context"
	"sort"
	"strings"
	"time"

	"mjbj/internal/compras"
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
// cobros, las compras, los pagos a proveedores y los gastos, en orden de
// fecha.
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

	rs, err = s.pool.Query(ctx, `
		SELECT p.fecha, i.tipo::text, i.punto_venta, i.numero, i.receptor_nombre, p.monto, p.medio::text
		FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
		WHERE p.fecha >= $1 AND p.fecha <= $2 AND p.medio <> 'cuenta_corriente' ORDER BY p.fecha`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var fecha time.Time
		var tipo, cliente, medio string
		var pv, nro int64
		var monto jsmath.Num
		if err := rs.Scan(&fecha, &tipo, &pv, &nro, &cliente, &monto, &medio); err != nil {
			rs.Close()
			return nil, err
		}
		asientos = append(asientos, AsientoDeCobro(CobroAAsentar{Fecha: fecha,
			Comprobante: NombreComprobante(tipo) + " " + NumeroFormateado(pv, nro), Cliente: cliente, Importe: monto.F(), Medio: medio}))
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	rs, err = s.pool.Query(ctx, `
		SELECT f.fecha_emision, f.tipo::text, f.punto_venta, f.numero, s.nombre, f.neto, f.iva21, f.iva105, f.iva27, f.percepciones, f.total, f.exento
		FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id
		WHERE f.fecha_emision >= $1 AND f.fecha_emision <= $2 ORDER BY f.fecha_emision`, desde, hasta)
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
		SELECT p.fecha, s.nombre, p.referencia, p.total, p.neto, p.medio
		FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id
		WHERE p.fecha >= $1 AND p.fecha <= $2 ORDER BY p.fecha`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var fecha time.Time
		var proveedor, medio string
		var referencia *string
		var total, neto jsmath.Num
		if err := rs.Scan(&fecha, &proveedor, &referencia, &total, &neto, &medio); err != nil {
			rs.Close()
			return nil, err
		}
		asientos = append(asientos, AsientoDePagoAProveedor(PagoAAsentar{Fecha: fecha, Proveedor: proveedor, Referencia: referencia,
			Total: total.F(), Retenido: total.F() - neto.F(), Medio: medio}))
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	rs, err = s.pool.Query(ctx, `
		SELECT fecha, descripcion, categoria::text, importe, medio::text
		FROM expenses WHERE fecha >= $1 AND fecha <= $2 ORDER BY fecha`, desde, hasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var g GastoAAsentar
		var importe jsmath.Num
		if err := rs.Scan(&g.Fecha, &g.Descripcion, &g.Categoria, &importe, &g.Medio); err != nil {
			rs.Close()
			return nil, err
		}
		g.Importe = importe.F()
		asientos = append(asientos, AsientoDeGasto(g))
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
		     AND NOT EXISTS (SELECT 1 FROM purchase_invoices f WHERE f.receipt_id = g.id))`, desde, hasta, ihasta).
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
		FROM purchase_invoices WHERE fecha_emision >= $1 AND fecha_emision <= $2`, desde, hasta).
		Scan(&cn, &ci, &ct, &r.Compras.Cantidad)
	if err != nil {
		return r, err
	}
	err = s.pool.QueryRow(ctx, `
		SELECT
		  (SELECT coalesce(sum(importe), 0) FROM expenses WHERE fecha >= $1 AND fecha <= $2),
		  (SELECT count(*)::int FROM expenses WHERE fecha >= $1 AND fecha <= $2),
		  (SELECT coalesce(sum(importe), 0) FROM retenciones_practicadas WHERE fecha >= $3 AND fecha <= $4),
		  (SELECT count(*)::int FROM retenciones_practicadas WHERE fecha >= $3 AND fecha <= $4),
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
