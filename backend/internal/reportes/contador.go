package reportes

import (
	"context"
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
)

// Los dos listados que pide el contador al cierre y que no salían de ningún
// lado: quién debe y desde cuándo, y a quién se le debe y cuándo vence.

// CsvDeudores es la deuda de cada cuenta por antigüedad, con la misma
// cuenta que la cobranza (los pagos cancelan lo más viejo primero). El que
// debe más y hace más tiempo va arriba. Van también los clientes dados de
// baja: la baja no cancela la deuda.
//
// **Es el mayor de Deudores por ventas (1.1.03) del CSV del estudio, cuenta
// por cuenta** (comité final, M7): sale del reparto de los cobros
// (cobros.RepartirCobros), no de la cuenta corriente. La cuenta corriente
// mezcla la deuda del circuito B —la venta sin factura a cuenta—, y el
// listado no se podía conciliar con el mayor que el contador tiene en el
// otro archivo. Una venta de un pedido sin cliente que se facturó y no se
// cobró figura con el contacto del pedido: su factura está en Deudores
// igual. El cierre avisa si el total no da el saldo de 1.1.03
// (PendientesDelCierre).
func (s *Servicio) CsvDeudores(ctx context.Context, ahora time.Time) (string, error) {
	reparto, err := s.repartoHasta(ctx, ahora)
	if err != nil {
		return "", err
	}
	type cuenta struct {
		codigo, nombre, cuit, telefono string
	}
	sinCae, err := s.deudaSinCae(ctx, reparto)
	if err != nil {
		return "", err
	}
	claves := make([]string, 0, len(reparto.MovimientosDeDeudores)+len(sinCae))
	for k := range reparto.MovimientosDeDeudores {
		claves = append(claves, k)
	}
	for k := range sinCae {
		if _, ok := reparto.MovimientosDeDeudores[k]; !ok {
			claves = append(claves, k)
		}
	}
	sort.Strings(claves)
	ids := map[string][]string{}
	for _, k := range claves {
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
	if err := leer("c:", `SELECT id::text, coalesce(codigo_legacy, ''), nombre, coalesce(cuit, ''),
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
		c      cuenta
		aging  cobros.Aging
		sinCae float64
	}
	var filas []fila
	for _, k := range claves {
		a := cobros.CalcularAging(reparto.MovimientosDeDeudores[k], ahora)
		if a.Total > 0.005 || sinCae[k] > 0.005 {
			filas = append(filas, fila{datos[k], a, sinCae[k]})
		}
	}
	sort.SliceStable(filas, func(i, j int) bool {
		vi, vj := filas[i].aging.Total-filas[i].aging.Tramos[0].Monto, filas[j].aging.Total-filas[j].aging.Tramos[0].Monto
		if vi != vj {
			return vi > vj
		}
		return filas[i].aging.Total > filas[j].aging.Total
	})
	var out [][]string
	var tot [5]float64
	var totSinCae float64
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
		for i, t := range f.aging.Tramos {
			r = append(r, csvexcel.NumeroCsv(t.Monto, 2))
			tot[i] += t.Monto
		}
		tot[4] += f.aging.Total
		totSinCae += f.sinCae
		r = append(r, csvexcel.NumeroCsv(f.aging.Total, 2), dias, csvexcel.NumeroCsv(jsmath.Redondear2(f.sinCae), 2))
		out = append(out, r)
	}
	return csvexcel.ArmarCsv(
		[]string{"Código", "Cliente", "CUIT", "Teléfono", "Al día (0-30)", "31 a 60 días", "61 a 90 días", "Más de 90 días", "Total", "Días de la más vieja",
			"Facturas sin CAE"},
		out,
		[]string{"", "Total", "", "", csvexcel.NumeroCsv(tot[0], 2), csvexcel.NumeroCsv(tot[1], 2), csvexcel.NumeroCsv(tot[2], 2),
			csvexcel.NumeroCsv(tot[3], 2), csvexcel.NumeroCsv(tot[4], 2), "", csvexcel.NumeroCsv(jsmath.Redondear2(totSinCae), 2)},
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
		FROM invoices i LEFT JOIN (SELECT invoice_id, sum(monto) AS cobrado, sum(monto) FILTER (WHERE medio <> 'cuenta_corriente') AS cobrado_contado FROM invoice_payments GROUP BY invoice_id) c ON c.invoice_id = i.id
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
		out = append(out, []string{csvexcel.Texto(proveedor), csvexcel.Texto(cuit), csvexcel.Texto(comp), dia(&emision),
			dia(vence), atraso, csvexcel.NumeroCsv(total.F(), 2), csvexcel.NumeroCsv(saldo.F(), 2)})
		totalSaldo += saldo.F()
		facturado[id] = float64(facturado[id] + saldo.F())
		return nil
	}); err != nil {
		return "", err
	}
	// La diferencia de cada libro con sus facturas, como Debo: lo que se
	// debe es el libro si es positivo.
	rs, err = s.lectura.Query(ctx, `SELECT s.id::text, s.nombre, coalesce(s.cuit, ''), coalesce(sum(m.monto), 0)::float8
		FROM suppliers s LEFT JOIN supplier_movements m ON m.supplier_id = s.id WHERE s.active GROUP BY s.id ORDER BY s.nombre`)
	if err != nil {
		return "", err
	}
	var libro float64
	if _, err := pgx.ForEachRow(rs, []any{&id, &proveedor, &cuit, &libro}, func() error {
		debe := max(libro, 0)
		if dif := jsmath.Redondear2(debe - facturado[id]); dif > 0.009 || dif < -0.009 {
			concepto := "Recibido sin factura y ajustes"
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
