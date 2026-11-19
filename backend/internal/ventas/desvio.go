package ventas

import "mjbj/internal/jsmath"

// Lo que una venta deja de cobrar contra la lista (T3, hallazgo 10).
//
// La regla, escrita una sola vez para el mostrador y el presupuesto vencido:
//
//   - Por renglón, lo que el precio quedó por debajo de su lista, por la
//     cantidad. Un renglón por encima de la lista **no compensa** a otro por
//     debajo: subir un tornillo para bajar una placa sigue siendo vender la
//     placa bajo la lista.
//   - Más el descuento tipeado a mano sobre el total (el «redondeame»). La
//     escala automática por medio de pago no cuenta: es regla del negocio.
//   - Más lo que falta cobrar del corte (placas o pasadas que el plano libre
//     cobra y la venta no trae).
//   - Se mide contra el total de lista de la venta: los renglones sin lista
//     (un flete, algo cargado a mano) entran a la base con su precio.
//
// Pasa sin autorización si lo dejado de cobrar no supera el porcentaje libre
// de esa base.

// Desvio es lo que la venta deja de cobrar.
type Desvio struct {
	BajoLista float64
	Manual    float64
	Corte     float64
	// Total es lo que se autoriza.
	Total float64
	// Base es el total de la venta a precio de lista.
	Base float64
}

// DesvioDeLaVenta calcula lo dejado de cobrar. Las líneas son las de antes
// del descuento, con PrecioLista ya puesto.
func DesvioDeLaVenta(lineas []LineaDeVenta, descuentoManual, faltaDelCorte float64) Desvio {
	var d Desvio
	for _, l := range lineas {
		if l.PrecioLista != nil {
			d.Base += ACentavos(float64(l.Cantidad * *l.PrecioLista))
			if dif := *l.PrecioLista - l.PrecioUnitario; dif > 0.005 {
				d.BajoLista += ACentavos(float64(dif * l.Cantidad))
			}
			continue
		}
		d.Base += ACentavos(float64(l.Cantidad * l.PrecioUnitario))
	}
	d.BajoLista = ACentavos(d.BajoLista)
	d.Manual = ACentavos(descuentoManual)
	d.Corte = ACentavos(faltaDelCorte)
	d.Base = ACentavos(d.Base + d.Corte)
	d.Total = ACentavos(d.BajoLista + d.Manual + d.Corte)
	return d
}

// DentroDeLoLibre: lo dejado de cobrar no pasa el porcentaje libre de la
// base (con medio centavo de tolerancia).
func (d Desvio) DentroDeLoLibre(pct float64) bool {
	if d.Total <= 0.005 {
		return true
	}
	return d.Total <= jsmath.Round(float64(d.Base*pct))/100+0.005
}
