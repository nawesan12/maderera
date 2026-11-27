package reportes

import (
	"context"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
	"mjbj/internal/csvexcel"
	"mjbj/internal/facturacion"
	"mjbj/internal/jsmath"
	"mjbj/internal/pdf"
	"mjbj/internal/reglas"
	"mjbj/internal/ventas/fragmentos"
)

// Los dos listados que pide el contador al cierre y que no salían de ningún
// lado: quién debe y desde cuándo, y a quién se le debe y cuándo vence.

// CsvDeudores es la deuda de cada cliente por antigüedad, **con el mismo
// saldo que su ficha** más lo que debe fuera de la cuenta: las facturas con
// saldo (el de Facturación) y lo entregado sin factura y sin cobrar (la cifra
// de «Me deben»), y partida en tres columnas que suman ese total
// (mes simulado, M2S1-008 y M3S4-001):
//
//   - **Con CAE**: el mayor de Deudores por ventas (1.1.03) del archivo del
//     estudio, cuenta por cuenta (cobros.RepartirCobros). Su total es el
//     saldo de 1.1.03, y el cierre avisa si no (PendientesDelCierre).
//   - **Facturas sin CAE**: lo que se debe de facturas emitidas que esperan
//     el CAE, hasta lo que la cuenta debe de verdad.
//   - **El circuito B**: el resto, lo que se debe de ventas sin factura.
//
// Antes el listado era solo el mayor: el estudio recibía $ 84.300 de
// deudores con «Me deben» en $ 3,9 millones, sin los clientes que deben del
// B y con la columna sin CAE inflada por lo que ya se había cobrado. Los
// tramos de antigüedad salen de la cuenta (los pagos cancelan lo más viejo
// primero), así no quedan en cero mientras no haya CAE. Van también los
// saldos a favor, en negativo (M3S1-018): sin ellos el total no llega al
// mayor. Abajo, lo que deben, los saldos a favor y el total.
func (s *Servicio) CsvDeudores(ctx context.Context, ahora time.Time) (string, error) {
	reparto, err := s.repartoHasta(ctx, ahora)
	if err != nil {
		return "", err
	}
	sinCae, err := s.deudaSinCae(ctx, reparto)
	if err != nil {
		return "", err
	}
	// Lo de cada cliente en la cuenta corriente y lo entregado sin cobrar que
	// no pasó por ella (por cliente, o por pedido si no tiene).
	movs := map[string][]cobros.Movimiento{}
	rs, err := s.lectura.Query(ctx, `SELECT 'c:' || m.customer_id::text, m.monto::float8, m.created_at FROM account_movements m
		WHERE m.created_at <= $1 ORDER BY m.created_at, m.id`, ahora)
	if err != nil {
		return "", err
	}
	var clave string
	var monto float64
	var fecha time.Time
	if _, err := pgx.ForEachRow(rs, []any{&clave, &monto, &fecha}, func() error {
		movs[clave] = append(movs[clave], cobros.Movimiento{Monto: monto, Fecha: fecha})
		return nil
	}); err != nil {
		return "", err
	}
	// Lo que se debe fuera de la cuenta: cada factura con su saldo (el de
	// Facturación) y lo entregado sin factura y sin cobrar (el de «Me deben»).
	rs, err = s.lectura.Query(ctx, `
		SELECT CASE WHEN i.customer_id IS NOT NULL THEN 'c:' || i.customer_id::text
		            WHEN i.order_id IS NOT NULL THEN 'p:' || i.order_id::text ELSE 'f:' || i.id::text END,
		  (`+facturacion.SaldoDeFactura+`)::float8, i.fecha_emision
		FROM invoices i LEFT JOIN `+facturacion.CobrosDeFacturas+` c ON c.invoice_id = i.id
		LEFT JOIN orders o ON o.id = i.order_id
		WHERE i.tipo::text LIKE 'factura%' AND i.estado IN ('emitida', 'autorizada', 'rechazada') AND i.fecha_emision <= $1
		  AND (o.id IS NULL OR o.estado <> 'cancelado') AND NOT `+facturacion.EnCuentaDeFactura+`
		  AND (`+facturacion.SaldoDeFactura+`) > 0.009
		UNION ALL
		SELECT coalesce('c:' || o.customer_id::text, 'p:' || o.id::text), x.saldo::float8, coalesce(o.vendido_at, o.created_at)
		FROM orders o CROSS JOIN LATERAL (SELECT `+fragmentos.SinCobrarDeLoQueSalio+` AS saldo) x
		WHERE `+fragmentos.SalioMercaderia+` AND x.saldo > 0.009
		  AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.tipo::text LIKE 'factura%' AND i.estado IN ('emitida', 'autorizada', 'rechazada'))`, ahora)
	if err != nil {
		return "", err
	}
	if _, err := pgx.ForEachRow(rs, []any{&clave, &monto, &fecha}, func() error {
		movs[clave] = append(movs[clave], cobros.Movimiento{Monto: monto, Fecha: fecha})
		return nil
	}); err != nil {
		return "", err
	}
	claves := map[string]bool{}
	for k := range movs {
		claves[k] = true
	}
	for k, v := range reparto.Deudores {
		if v > 0.005 || v < -0.005 {
			claves[k] = true
		}
	}
	type cuenta struct {
		codigo, nombre, cuit, telefono string
	}
	ids := map[string][]string{}
	for k := range claves {
		ids[k[:2]] = append(ids[k[:2]], k[2:])
	}
	datos := map[string]cuenta{}
	leer := func(prefijo, sql string) error {
		if len(ids[prefijo]) == 0 {
			return nil
		}
		rs, err := s.lectura.Query(ctx, sql, ids[prefijo])
		if err != nil {
			return err
		}
		var id string
		var c cuenta
		_, err = pgx.ForEachRow(rs, []any{&id, &c.codigo, &c.nombre, &c.cuit, &c.telefono}, func() error {
			datos[prefijo+id] = c
			return nil
		})
		return err
	}
	if err := leer("c:", `SELECT id::text, coalesce(codigo_legacy, ''), coalesce(nullif(razon_social, ''), nombre), coalesce(cuit, ''),
		coalesce(telefono, '') FROM customers WHERE id::text = ANY($1)`); err != nil {
		return "", err
	}
	if err := leer("p:", `SELECT id::text, numero, contacto_nombre, '', coalesce(contacto_telefono, '') FROM orders WHERE id::text = ANY($1)`); err != nil {
		return "", err
	}
	if err := leer("f:", `SELECT id::text, '', receptor_nombre, coalesce(receptor_cuit, ''), '' FROM invoices WHERE id::text = ANY($1)`); err != nil {
		return "", err
	}
	type fila struct {
		c                    cuenta
		aging                cobros.Aging
		total, mayor, sinCae float64
		b                    float64
	}
	var filas []fila
	for k := range claves {
		a := cobros.CalcularAging(movs[k], ahora)
		total := jsmath.Redondear2(a.Total - a.AFavor)
		mayor := jsmath.Redondear2(reparto.Deudores[k])
		sc := jsmath.Redondear2(min(max(sinCae[k], 0), max(jsmath.Redondear2(total-mayor), 0)))
		f := fila{c: datos[k], aging: a, total: total, mayor: mayor, sinCae: sc, b: jsmath.Redondear2(total - mayor - sc)}
		if math.Abs(f.total) > 0.005 || math.Abs(f.mayor) > 0.005 {
			filas = append(filas, f)
		}
	}
	sort.SliceStable(filas, func(i, j int) bool {
		vi, vj := filas[i].aging.Total-filas[i].aging.Tramos[0].Monto, filas[j].aging.Total-filas[j].aging.Tramos[0].Monto
		if vi != vj {
			return vi > vj
		}
		if filas[i].total != filas[j].total {
			return filas[i].total > filas[j].total
		}
		return filas[i].c.nombre < filas[j].c.nombre
	})
	var out [][]string
	type suma struct {
		tramos                  [4]float64
		total, mayor, sinCae, b float64
	}
	var deben, aFavor, todo suma
	sumar := func(x *suma, f fila) {
		for i, t := range f.aging.Tramos {
			x.tramos[i] += t.Monto
		}
		x.total += f.total
		x.mayor += f.mayor
		x.sinCae += f.sinCae
		x.b += f.b
	}
	for _, f := range filas {
		dias := ""
		if f.aging.DiasDeLaMasVieja != nil {
			dias = strconv.Itoa(*f.aging.DiasDeLaMasVieja)
		}
		// El CUIT con guiones, como lo escribe el resto del sistema: unos
		// clientes lo tenían cargado con guiones y otros sin (mes simulado).
		cuit := f.c.cuit
		if cuit != "" {
			cuit = pdf.Cuit(cuit)
		}
		r := []string{csvexcel.Texto(f.c.codigo), csvexcel.Texto(f.c.nombre), csvexcel.Texto(cuit), csvexcel.Texto(f.c.telefono)}
		for _, t := range f.aging.Tramos {
			r = append(r, csvexcel.NumeroCsv(t.Monto, 2))
		}
		r = append(r, csvexcel.NumeroCsv(f.total, 2), dias, csvexcel.NumeroCsv(f.mayor, 2), csvexcel.NumeroCsv(f.sinCae, 2), csvexcel.NumeroCsv(f.b, 2))
		out = append(out, r)
		if f.total >= 0 {
			sumar(&deben, f)
		} else {
			sumar(&aFavor, f)
		}
		sumar(&todo, f)
	}
	renglon := func(nombre string, x suma) []string {
		r := []string{"", csvexcel.Texto(nombre), "", ""}
		for _, t := range x.tramos {
			r = append(r, csvexcel.NumeroCsv(jsmath.Redondear2(t), 2))
		}
		return append(r, csvexcel.NumeroCsv(jsmath.Redondear2(x.total), 2), "", csvexcel.NumeroCsv(jsmath.Redondear2(x.mayor), 2),
			csvexcel.NumeroCsv(jsmath.Redondear2(x.sinCae), 2), csvexcel.NumeroCsv(jsmath.Redondear2(x.b), 2))
	}
	out = append(out, renglon("Deben", deben), renglon("Saldos a favor", aFavor))
	circuito := reglas.Circuito(ctx, s.pool)
	return csvexcel.ArmarCsv(
		[]string{"Código", "Cliente", "CUIT", "Teléfono", "Al día (0-30)", "31 a 60 días", "61 a 90 días", "Más de 90 días", "Total", "Días de la más vieja",
			"Con CAE (1.1.03)", "Facturas sin CAE", strings.ToUpper(circuito[:1]) + circuito[1:]},
		out, renglon("Total", todo),
	), nil
}

// deudaSinCae es, por cuenta del reparto (c:cliente, p:pedido, f:factura),
// lo que se debe de facturas emitidas que esperan el CAE: no están en
// Deudores por ventas (1.1.03) porque para el fisco todavía no existen, y
// sin esto el listado del contador salía en cero con «Me deben» en millones
// (simulación del mes, H154). Va en su propia columna, fuera del Total que
// se concilia con el mayor, y sin la deuda del circuito B.
//
// De la factura de un pedido, lo que el pedido debe (SaldoDeFactura); de la
// que va a cuenta corriente, su total, menos lo que quedó en Anticipos de
// esa cuenta esperándola (las bolsas del reparto).
func (s *Servicio) deudaSinCae(ctx context.Context, reparto cobros.ResultadoDelReparto) (map[string]float64, error) {
	rs, err := s.lectura.Query(ctx, `
		SELECT CASE WHEN i.customer_id IS NOT NULL THEN 'c:' || i.customer_id::text
		            WHEN i.order_id IS NOT NULL THEN 'p:' || i.order_id::text ELSE 'f:' || i.id::text END,
		  (CASE WHEN `+facturacion.EnCuentaDeFactura+` THEN i.total ELSE `+facturacion.SaldoDeFactura+` END)::float8
		FROM invoices i LEFT JOIN `+facturacion.CobrosDeFacturas+` c ON c.invoice_id = i.id
		LEFT JOIN orders o ON o.id = i.order_id
		WHERE i.cae IS NULL AND i.estado IN ('emitida', 'rechazada') AND i.tipo::text LIKE 'factura%'
		  AND (o.id IS NULL OR o.estado <> 'cancelado')`)
	if err != nil {
		return nil, err
	}
	out := map[string]float64{}
	var clave string
	var monto float64
	if _, err := pgx.ForEachRow(rs, []any{&clave, &monto}, func() error {
		out[clave] = float64(out[clave] + monto)
		return nil
	}); err != nil {
		return nil, err
	}
	for _, b := range reparto.Bolsas {
		if _, ok := out[b.Clave]; ok {
			out[b.Clave] = float64(out[b.Clave] - b.Monto)
		}
	}
	for k, v := range out {
		if v < 0.005 {
			delete(out, k)
		}
	}
	return out, nil
}

// CsvCuentasAPagar son las facturas de compra con saldo, la que vence antes
// primero, con los días de atraso, y por cada proveedor la diferencia con su
// libro: lo recibido con remito y sin factura, el saldo inicial y los
// ajustes suman; las notas de crédito y los pagos a cuenta sin imputar
// restan. Así el total es el «Debo» del inicio (Debo), proveedor por
// proveedor. Antes el archivo listaba solo las facturas: faltaban
// $ 40 M de remitos sin aviso y la nota de crédito de Herrajes no restaba
// (simulación del mes, H161/H418).
func (s *Servicio) CsvCuentasAPagar(ctx context.Context, ahora time.Time) (string, error) {
	rs, err := s.lectura.Query(ctx, `
		SELECT s.id::text, s.nombre, coalesce(s.cuit, ''), f.tipo::text, f.punto_venta, f.numero, f.fecha_emision, f.fecha_vencimiento, f.total,
		       `+saldoDeCompra+` AS saldo
		FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id
		WHERE s.active AND f.anulada_at IS NULL AND f.tipo::text NOT LIKE 'nota_credito%' AND `+saldoDeCompra+` > 0.009
		ORDER BY f.fecha_vencimiento NULLS LAST, f.fecha_emision`)
	if err != nil {
		return "", err
	}
	hoy := InicioDelDia(ahora)
	var out [][]string
	var totalSaldo float64
	facturado := map[string]float64{}
	var id, proveedor, cuit, tipo string
	var pv, numero int64
	var emision time.Time
	var vence *time.Time
	var total, saldo jsmath.Num
	if _, err := pgx.ForEachRow(rs, []any{&id, &proveedor, &cuit, &tipo, &pv, &numero, &emision, &vence, &total, &saldo}, func() error {
		atraso := ""
		if vence != nil && vence.Before(hoy) {
			atraso = strconv.Itoa(int(hoy.Sub(*vence).Hours() / 24))
		}
		comp := nombreDeComprobante(tipo) + " " + pad(pv, 4) + "-" + pad(numero, 8)
		// Con guiones como en deudores: un proveedor migrado lo tenía sin
		// ellos y la columna salía mezclada (M2S2-103).
		conGuiones := cuit
		if conGuiones != "" {
			conGuiones = pdf.Cuit(conGuiones)
		}
		out = append(out, []string{csvexcel.Texto(proveedor), csvexcel.Texto(conGuiones), csvexcel.Texto(comp), dia(&emision),
			dia(vence), atraso, csvexcel.NumeroCsv(total.F(), 2), csvexcel.NumeroCsv(saldo.F(), 2)})
		totalSaldo += saldo.F()
		facturado[id] = float64(facturado[id] + saldo.F())
		return nil
	}); err != nil {
		return "", err
	}
	// La diferencia de cada libro con sus facturas, como Debo: lo que se
	// debe es el libro si es positivo. Va renglón por renglón (mes simulado,
	// M2S1-144): cada recepción sin factura con su remito, su orden y su
	// fecha, para reclamar la factura que falta, y cada ajuste del libro con
	// su detalle. Lo que no se explica así (notas de crédito sin aplicar,
	// pagos a cuenta) va en un renglón por proveedor.
	type renglonDelLibro struct {
		concepto string
		fecha    *time.Time
		monto    float64
	}
	detalle := map[string][]renglonDelLibro{}
	rs, err = s.lectura.Query(ctx, `
		SELECT m.supplier_id::text, 'Remito ' || coalesce(nullif(g.numero_remito, ''), 's/n') || coalesce(' · ' || nullif(o.numero, ''), '') || ' sin factura',
		  g.fecha, sum(m.monto)::float8
		FROM supplier_movements m JOIN goods_receipts g ON g.id = m.goods_receipt_id LEFT JOIN purchase_orders o ON o.id = g.purchase_order_id
		WHERE g.estado = 'confirmada' AND `+RecepcionSinFactura+`
		GROUP BY m.supplier_id, g.id, g.numero_remito, o.numero, g.fecha HAVING abs(sum(m.monto)) > 0.009
		UNION ALL
		SELECT m.supplier_id::text, coalesce(nullif(m.detalle, ''), 'Ajuste'),
		  ((m.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::timestamp AT TIME ZONE 'UTC', m.monto::float8
		FROM supplier_movements m WHERE `+AjusteDeProveedor+` AND m.monto <> 0
		ORDER BY 1, 3`)
	if err != nil {
		return "", err
	}
	var concepto string
	var cuando *time.Time
	var monto float64
	if _, err := pgx.ForEachRow(rs, []any{&id, &concepto, &cuando, &monto}, func() error {
		detalle[id] = append(detalle[id], renglonDelLibro{concepto, cuando, monto})
		return nil
	}); err != nil {
		return "", err
	}
	rs, err = s.lectura.Query(ctx, `SELECT s.id::text, s.nombre, coalesce(s.cuit, ''), coalesce(sum(m.monto), 0)::float8
		FROM suppliers s LEFT JOIN supplier_movements m ON m.supplier_id = s.id WHERE s.active GROUP BY s.id ORDER BY s.nombre`)
	if err != nil {
		return "", err
	}
	var libro float64
	if _, err := pgx.ForEachRow(rs, []any{&id, &proveedor, &cuit, &libro}, func() error {
		debe := max(libro, 0)
		dif := jsmath.Redondear2(debe - facturado[id])
		if !(dif > 0.009 || dif < -0.009) {
			return nil
		}
		for _, r := range detalle[id] {
			out = append(out, []string{csvexcel.Texto(proveedor), csvexcel.Texto(cuit), csvexcel.Texto(r.concepto), dia(r.fecha), "", "", "",
				csvexcel.NumeroCsv(r.monto, 2)})
			totalSaldo += r.monto
			dif = jsmath.Redondear2(dif - r.monto)
		}
		if dif > 0.009 || dif < -0.009 {
			concepto := "Otros movimientos del libro"
			if dif < 0 {
				concepto = "Notas de crédito y pagos a cuenta"
			}
			out = append(out, []string{csvexcel.Texto(proveedor), csvexcel.Texto(cuit), csvexcel.Texto(concepto), "", "", "", "",
				csvexcel.NumeroCsv(dif, 2)})
			totalSaldo += dif
		}
		return nil
	}); err != nil {
		return "", err
	}
	return csvexcel.ArmarCsv(
		[]string{"Proveedor", "CUIT", "Comprobante", "Emisión", "Vence", "Días vencida", "Total", "Saldo"},
		out,
		[]string{"Total", "", "", "", "", "", "", csvexcel.NumeroCsv(jsmath.Redondear2(totalSaldo), 2)},
	), nil
}

func pad(n int64, ancho int) string {
	t := strconv.FormatInt(n, 10)
	for len(t) < ancho {
		t = "0" + t
	}
	return t
}

// dia escribe una columna date: llega a las 0 UTC, y pasada a hora argentina
// saldría el día anterior.
func dia(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format("02/01/2006")
}

// nombreDeComprobante: «factura_a» es «Factura A».
func nombreDeComprobante(tipo string) string {
	letra := strings.ToUpper(tipo[len(tipo)-1:])
	switch {
	case strings.HasPrefix(tipo, "nota_debito"):
		return "Nota de débito " + letra
	case strings.HasPrefix(tipo, "factura"):
		return "Factura " + letra
	}
	return tipo
}
