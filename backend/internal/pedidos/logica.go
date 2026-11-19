package pedidos

import (
	"math"
	"time"

	"mjbj/internal/jsmath"
)

// Las cuentas sin base: el plazo de un presupuesto y el margen de un pedido.
// Golden: scripts/golden/pedidos.ts (plazo.json y margen.json).

// Plazo es cómo se lee un compromiso que corre («Quedan 3 h»).
type Plazo struct {
	Texto   string `json:"texto"`
	Urgente bool   `json:"urgente"`
	Vencido bool   `json:"vencido"`
}

// EstadoDelPlazo es estadoDelPlazo de lib/plazos.ts: el texto y si conviene
// marcarlo. Cuenta en milisegundos, como getTime().
func EstadoDelPlazo(vence, ahora time.Time) Plazo {
	restante := vence.UnixMilli() - ahora.UnixMilli()
	horas := float64(restante) / 3_600_000
	if restante <= 0 {
		pasadas := math.Floor(-horas)
		texto := "Se pasó de hora"
		if pasadas >= 1 {
			texto = "Se pasó por " + jsmath.Texto(pasadas) + " h"
		}
		return Plazo{texto, true, true}
	}
	if horas < 1 {
		return Plazo{"Quedan " + jsmath.Texto(math.Max(1, jsmath.Round(float64(restante)/60_000))) + " min", true, false}
	}
	if horas < 24 {
		return Plazo{"Quedan " + jsmath.Texto(math.Floor(horas)) + " h", horas < 4, false}
	}
	return Plazo{"Quedan " + jsmath.Texto(math.Floor(horas/24)) + " días", false, false}
}

// redondear4 es el redondear de lib/compras/costo.ts: a cuatro decimales.
func redondear4(n float64) float64 { return jsmath.Round(float64(n*10000)) / 10000 }

// MargenDeLaLinea es margenDeLinea (lib/compras/costo.ts): neto contra neto,
// con la alícuota de la línea. CostoTotal nil: la línea no tiene costo.
type MargenDeLaLinea struct {
	NetoVenta  float64
	CostoTotal *float64
}

// MargenDeLinea compara el neto de lo vendido con el costo congelado.
//
// Un costo en $0 (o menos) es un costo sin cargar, como en Reportes
// (costo_unitario > 0): tomarlo como costo daba 100 % de margen en la ficha
// del pedido mientras Reportes decía «sin costo» del mismo renglón.
func MargenDeLinea(subtotal, cantidad, alicuota float64, costo *float64) MargenDeLaLinea {
	neto := redondear4(subtotal / float64(1+alicuota/100))
	if costo == nil || math.IsNaN(*costo) || math.IsInf(*costo, 0) || *costo <= 0 {
		return MargenDeLaLinea{NetoVenta: neto}
	}
	c := redondear4(float64(*costo * cantidad))
	return MargenDeLaLinea{NetoVenta: neto, CostoTotal: &c}
}

// LineaConCosto es lo que mira el margen de una línea del pedido (los
// numeric como texto, como los leía drizzle).
type LineaConCosto struct {
	Subtotal      string
	Cantidad      string
	AlicuotaIva   *string
	CostoUnitario *string
	// Lo que las devoluciones parciales se llevaron del renglón (cantidad e
	// importe con IVA): no es vendido, como en Reportes.
	DevueltoCantidad, DevueltoImporte float64
}

// Margen es el de la ficha del pedido (calcularMargen de la página).
type Margen struct {
	Neto     float64 `json:"neto"`
	Costo    float64 `json:"costo"`
	Ganancia float64 `json:"ganancia"`
	SinCosto int     `json:"sinCosto"`
}

// MargenDelPedido suma renglón por renglón. Nil si ninguna línea tiene
// costo (lo anterior al módulo de compras): mostrar cero diría que se vendió
// sin ganancia, que no es lo mismo que no saberlo.
func MargenDelPedido(items []LineaConCosto) *Margen {
	var neto, costo float64
	con, sin := 0, 0
	for _, it := range items {
		alicuota := 21.0
		if it.AlicuotaIva != nil {
			alicuota = jsmath.Numero(*it.AlicuotaIva)
		}
		var c *float64
		if it.CostoUnitario != nil {
			x := jsmath.Numero(*it.CostoUnitario)
			c = &x
		}
		// Lo devuelto se resta (revisión del carril E): la ficha mostraba el
		// neto, el costo y la ganancia del pedido entero, y Reportes y el
		// Resultado el pedido sin lo devuelto. El mismo pedido daba dos
		// cifras.
		r := MargenDeLinea(float64(jsmath.Numero(it.Subtotal)-it.DevueltoImporte), float64(jsmath.Numero(it.Cantidad)-it.DevueltoCantidad), alicuota, c)
		if r.CostoTotal == nil {
			sin++
			continue
		}
		neto += r.NetoVenta
		costo += *r.CostoTotal
		con++
	}
	if con == 0 {
		return nil
	}
	return &Margen{Neto: neto, Costo: costo, Ganancia: neto - costo, SinCosto: sin}
}
