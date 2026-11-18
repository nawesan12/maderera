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
	"mjbj/internal/jsmath"
)

// Los dos listados que pide el contador al cierre y que no salían de ningún
// lado: quién debe y desde cuándo, y a quién se le debe y cuándo vence.

// CsvDeudores es la deuda de cada cliente por antigüedad, con la misma
// cuenta que la cobranza (los pagos cancelan lo más viejo primero). El que
// debe más y hace más tiempo va arriba. Van también los clientes dados de
// baja: la baja no cancela la deuda, y el contador la necesita igual (ya
// quedan afuera los que no deben, por el saldo).
//
// **No lleva los pedidos entregados sin cobrar**, que «Me deben» del
// Resumen sí suma (fragmentos.SinCobrarDelPedido): este archivo es el mayor
// de la cuenta corriente, lo que el contador concilia contra deudores por
// ventas, y esos pedidos no tienen asiento de deuda ni cliente obligado (son
// de contado que no se cobró). Por eso los dos totales difieren
// en ese renglón, que el Resumen muestra aparte.
func (s *Servicio) CsvDeudores(ctx context.Context, ahora time.Time) (string, error) {
	rs, err := s.pool.Query(ctx, `
		SELECT c.id, coalesce(c.codigo_legacy, ''), c.nombre, coalesce(c.cuit, ''), coalesce(c.telefono, ''), m.monto, m.created_at
		FROM customers c JOIN account_movements m ON m.customer_id = c.id
		ORDER BY c.id, m.created_at`)
	if err != nil {
		return "", err
	}
	type cliente struct {
		codigo, nombre, cuit, telefono string
		movs                           []cobros.Movimiento
	}
	por := map[string]*cliente{}
	var orden []string
	var id, codigo, nombre, cuit, telefono string
	var monto jsmath.Num
	var fecha time.Time
	if _, err := pgx.ForEachRow(rs, []any{&id, &codigo, &nombre, &cuit, &telefono, &monto, &fecha}, func() error {
		c, ok := por[id]
		if !ok {
			c = &cliente{codigo: codigo, nombre: nombre, cuit: cuit, telefono: telefono}
			por[id] = c
			orden = append(orden, id)
		}
		c.movs = append(c.movs, cobros.Movimiento{Monto: monto.F(), Fecha: fecha})
		return nil
	}); err != nil {
		return "", err
	}
	type fila struct {
		c     *cliente
		aging cobros.Aging
	}
	var filas []fila
	for _, k := range orden {
		a := cobros.CalcularAging(por[k].movs, ahora)
		if a.Total > 0.005 {
			filas = append(filas, fila{por[k], a})
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
	for _, f := range filas {
		dias := ""
		if f.aging.DiasDeLaMasVieja != nil {
			dias = strconv.Itoa(*f.aging.DiasDeLaMasVieja)
		}
		r := []string{csvexcel.Texto(f.c.codigo), csvexcel.Texto(f.c.nombre), csvexcel.Texto(f.c.cuit), csvexcel.Texto(f.c.telefono)}
		for i, t := range f.aging.Tramos {
			r = append(r, csvexcel.NumeroCsv(t.Monto, 2))
			tot[i] += t.Monto
		}
		tot[4] += f.aging.Total
		r = append(r, csvexcel.NumeroCsv(f.aging.Total, 2), dias)
		out = append(out, r)
	}
	return csvexcel.ArmarCsv(
		[]string{"Código", "Cliente", "CUIT", "Teléfono", "Al día (0-30)", "31 a 60 días", "61 a 90 días", "Más de 90 días", "Total", "Días de la más vieja"},
		out,
		[]string{"", "Total", "", "", csvexcel.NumeroCsv(tot[0], 2), csvexcel.NumeroCsv(tot[1], 2), csvexcel.NumeroCsv(tot[2], 2),
			csvexcel.NumeroCsv(tot[3], 2), csvexcel.NumeroCsv(tot[4], 2), ""},
	), nil
}

// CsvCuentasAPagar son las facturas de compra con saldo, la que vence antes
// primero, con los días de atraso.
func (s *Servicio) CsvCuentasAPagar(ctx context.Context, ahora time.Time) (string, error) {
	rs, err := s.pool.Query(ctx, `
		SELECT s.nombre, coalesce(s.cuit, ''), f.tipo::text, f.punto_venta, f.numero, f.fecha_emision, f.fecha_vencimiento, f.total,
		       `+saldoDeCompra+` AS saldo
		FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id
		WHERE f.anulada_at IS NULL AND f.tipo::text NOT LIKE 'nota_credito%' AND `+saldoDeCompra+` > 0.009
		ORDER BY f.fecha_vencimiento NULLS LAST, f.fecha_emision`)
	if err != nil {
		return "", err
	}
	hoy := InicioDelDia(ahora)
	var out [][]string
	var totalSaldo float64
	var proveedor, cuit, tipo string
	var pv, numero int64
	var emision time.Time
	var vence *time.Time
	var total, saldo jsmath.Num
	if _, err := pgx.ForEachRow(rs, []any{&proveedor, &cuit, &tipo, &pv, &numero, &emision, &vence, &total, &saldo}, func() error {
		atraso := ""
		if vence != nil && vence.Before(hoy) {
			atraso = strconv.Itoa(int(hoy.Sub(*vence).Hours() / 24))
		}
		comp := nombreDeComprobante(tipo) + " " + pad(pv, 4) + "-" + pad(numero, 8)
		out = append(out, []string{csvexcel.Texto(proveedor), csvexcel.Texto(cuit), csvexcel.Texto(comp), dia(&emision),
			dia(vence), atraso, csvexcel.NumeroCsv(total.F(), 2), csvexcel.NumeroCsv(saldo.F(), 2)})
		totalSaldo += saldo.F()
		return nil
	}); err != nil {
		return "", err
	}
	return csvexcel.ArmarCsv(
		[]string{"Proveedor", "CUIT", "Comprobante", "Emisión", "Vence", "Días vencida", "Total", "Saldo"},
		out,
		[]string{"Total", "", "", "", "", "", "", csvexcel.NumeroCsv(totalSaldo, 2)},
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
