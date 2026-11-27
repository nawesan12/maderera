package pedidos

import (
	"context"
	"math"
	"sort"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/reglas"
	"mjbj/internal/ventas"
)

// consultas es un pool o una transacción.
type consultas interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	reglas.Consultador
}

// netosDeLosRenglones es lo que se cobró de cada renglón: su subtotal menos
// la parte del descuento del pedido (mes 23, PED-1123: la devolución sin
// factura devolvía el precio de lista, $ 12.345, de un tirante cobrado
// $ 11.110,50 con el 10 % por transferencia; con factura la nota de crédito
// ya salía neta).
//
// El descuento por forma de pago va sobre lo del catálogo (y, con la regla
// descuento_al_flete, también lo cargado a mano), como al pasar el
// presupuesto a pedido; uno puesto a mano, sobre todo lo vendido. Se reparte
// en proporción y los centavos que sobran van al renglón más grande: la
// suma de los netos da justo el subtotal menos el descuento.
func netosDeLosRenglones(ctx context.Context, q consultas, pedido string) (map[string]float64, error) {
	filas, err := q.Query(ctx, `
		SELECT oi.id::text, oi.subtotal::float8, oi.variant_id IS NOT NULL, o.descuento::float8, o.subtotal::float8,
		       o.medio_pago IS NOT NULL AND EXISTS (SELECT 1 FROM payment_discounts pd
		         WHERE pd.medio = o.medio_pago AND pd.etiqueta = o.descuento_motivo)
		FROM order_items oi JOIN orders o ON o.id = oi.order_id
		WHERE oi.order_id = $1 ORDER BY oi.orden, oi.id`, pedido)
	if err != nil {
		return nil, err
	}
	type renglon struct {
		id       string
		subtotal float64
		catalogo bool
	}
	var renglones []renglon
	var descuento, subtotal float64
	var porMedio bool
	for filas.Next() {
		var r renglon
		if err := filas.Scan(&r.id, &r.subtotal, &r.catalogo, &descuento, &subtotal, &porMedio); err != nil {
			filas.Close()
			return nil, err
		}
		renglones = append(renglones, r)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}
	netos := make(map[string]float64, len(renglones))
	suma := 0.0
	for _, r := range renglones {
		netos[r.id] = r.subtotal
		suma = ventas.ACentavos(suma + r.subtotal)
	}
	// El mostrador reparte el descuento en los precios de los renglones
	// (ventas.AplicarDescuento) y guarda el subtotal de lista: ahí los
	// renglones ya son lo cobrado. Solo cuando suman el subtotal del pedido
	// el descuento quedó afuera (presupuesto, tienda).
	if descuento <= 0.005 || math.Abs(suma-subtotal) > 0.005 {
		return netos, nil
	}
	alFlete := !porMedio || reglas.Es(ctx, q, reglas.DescuentoAlFlete, "si")
	var enBase []renglon
	base := 0.0
	for _, r := range renglones {
		if (r.catalogo || alFlete) && r.subtotal > 0 {
			enBase = append(enBase, r)
			base = ventas.ACentavos(base + r.subtotal)
		}
	}
	if base <= 0.005 {
		return netos, nil
	}
	if descuento > base {
		descuento = base
	}
	repartido := 0.0
	for _, r := range enBase {
		parte := ventas.ACentavos(float64(descuento*r.subtotal) / base)
		netos[r.id] = ventas.ACentavos(r.subtotal - parte)
		repartido = ventas.ACentavos(repartido + parte)
	}
	// El más grande se queda con los centavos del redondeo.
	sort.SliceStable(enBase, func(i, j int) bool { return enBase[i].subtotal > enBase[j].subtotal })
	if resto := ventas.ACentavos(descuento - repartido); resto != 0 {
		netos[enBase[0].id] = ventas.ACentavos(netos[enBase[0].id] - resto)
	}
	return netos, nil
}
