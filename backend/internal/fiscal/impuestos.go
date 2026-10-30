// Package fiscal es la facturación electrónica sin base de datos: el IVA de
// lib/fiscal/impuestos.ts, la letra y los códigos de lib/fiscal/comprobantes.ts,
// las notas de lib/fiscal/notas.ts, la clave del candado de
// lib/fiscal/numeracion.ts y la conversación con ARCA (WSAA y WSFEv1) de
// lib/fiscal/proveedores. Todo lo que es cuenta tiene golden contra el TS
// (scripts/golden/fiscal.ts) y da lo mismo bit a bit.
//
// Los precios del catálogo son finales, con el IVA adentro: facturar es
// desagregar, nunca agregar.
package fiscal

import (
	"math"

	"mjbj/internal/jsmath"
)

// Alicuotas son las que puede tener un producto.
var Alicuotas = []float64{0, 10.5, 21, 27}

// AlicuotaValida: solo las de la lista. Otra no tiene Id de AlicIva, y el
// TS la mandaba como 21 % (Id 5) con el importe de otra alícuota.
func AlicuotaValida(a float64) bool {
	_, ok := CodigoAlicuotaArca[a]
	return ok
}

// MensajeAlicuota es el error de una alícuota fuera de la lista.
const MensajeAlicuota = "La alícuota de IVA tiene que ser 0, 10,5, 21 o 27 %."

// CodigoAlicuotaArca es el Id de AlicIva de WSFEv1.
var CodigoAlicuotaArca = map[float64]int{0: 3, 10.5: 4, 21: 5, 27: 6}

// Redondear es el `redondear` de impuestos.ts, tal cual:
// Math.round((valor + Number.EPSILON) * 100) / 100.
func Redondear(valor float64) float64 {
	return jsmath.Round(float64((valor+jsmath.Epsilon)*100)) / 100
}

// Desagregado es un precio final partido en neto e IVA.
type Desagregado struct {
	Neto     float64 `json:"neto"`
	Iva      float64 `json:"iva"`
	Total    float64 `json:"total"`
	Alicuota float64 `json:"alicuota"`
}

// sinAlicuota es `!alicuota || alicuota <= 0` de JS (NaN y 0 son falsos).
func sinAlicuota(a float64) bool { return a == 0 || math.IsNaN(a) || a <= 0 }

// Desagregar parte un precio final: neto = final / (1 + a/100), y el IVA es
// la diferencia (así las dos partes suman el total exacto).
func Desagregar(precioFinal, alicuota float64) Desagregado {
	total := Redondear(precioFinal)
	if sinAlicuota(alicuota) {
		return Desagregado{Neto: total, Iva: 0, Total: total, Alicuota: 0}
	}
	neto := Redondear(total / (1 + alicuota/100))
	return Desagregado{Neto: neto, Iva: Redondear(total - neto), Total: total, Alicuota: alicuota}
}

// AgregarIva es el camino inverso, para las cargas mayoristas.
func AgregarIva(neto, alicuota float64) float64 {
	if math.IsNaN(alicuota) {
		alicuota = 0
	}
	return Redondear(neto * (1 + alicuota/100))
}

// LineaEntrada es un renglón con precio final. Unidad y Alicuota en nil son
// el `undefined` del TS (unidad «unidad», alícuota 21).
type LineaEntrada struct {
	Descripcion         string   `json:"descripcion"`
	Unidad              *string  `json:"unidad,omitempty"`
	Cantidad            float64  `json:"cantidad"`
	PrecioFinalUnitario float64  `json:"precioFinalUnitario"`
	Alicuota            *float64 `json:"alicuota,omitempty"`
}

// LineaCalculada es el renglón con sus importes.
type LineaCalculada struct {
	Descripcion         string  `json:"descripcion"`
	Unidad              string  `json:"unidad"`
	Cantidad            float64 `json:"cantidad"`
	PrecioFinalUnitario float64 `json:"precioFinalUnitario"`
	Alicuota            float64 `json:"alicuota"`
	PrecioUnitarioNeto  float64 `json:"precioUnitarioNeto"`
	Neto                float64 `json:"neto"`
	Iva                 float64 `json:"iva"`
	Subtotal            float64 `json:"subtotal"`
}

// IvaDeAlicuota es una entrada del Map ivaPorAlicuota, en el orden en que
// apareció (el de inserción del Map de JS).
type IvaDeAlicuota struct {
	Alicuota float64 `json:"alicuota"`
	Base     float64 `json:"base"`
	Importe  float64 `json:"importe"`
}

// Totales es TotalesComprobante.
type Totales struct {
	Lineas         []LineaCalculada `json:"lineas"`
	Neto           float64          `json:"neto"`
	IvaPorAlicuota []IvaDeAlicuota  `json:"ivaPorAlicuota"`
	Iva            float64          `json:"iva"`
	Exento         float64          `json:"exento"`
	Total          float64          `json:"total"`
}

// IvaDe es ivaPorAlicuota.get(a)?.importe ?? 0.
func (t Totales) IvaDe(a float64) float64 {
	for _, x := range t.IvaPorAlicuota {
		if x.Alicuota == a {
			return x.Importe
		}
	}
	return 0
}

// CalcularTotales es calcularTotales: se desagrega sobre el total de cada
// renglón y el IVA se agrupa por alícuota.
//
// Neto es el neto **gravado**: lo exento (alícuota 0) va solo en Exento. El
// TS lo sumaba a los dos, y a ARCA le llegaba dos veces (ImpNeto + ImpOpEx):
// ImpTotal no cerraba y la factura se rechazaba (10048); la percepción de
// IIBB, que se calcula sobre el neto gravado, también salía inflada.
func CalcularTotales(lineas []LineaEntrada) Totales {
	out := Totales{Lineas: make([]LineaCalculada, 0, len(lineas)), IvaPorAlicuota: []IvaDeAlicuota{}}
	var neto, iva, exento, total float64
	for _, l := range lineas {
		alicuota := 21.0
		if l.Alicuota != nil {
			alicuota = *l.Alicuota
		}
		unidad := "unidad"
		if l.Unidad != nil {
			unidad = *l.Unidad
		}
		totalLinea := Redondear(float64(l.PrecioFinalUnitario * l.Cantidad))
		partes := Desagregar(totalLinea, alicuota)
		unitario := 0.0
		if l.Cantidad > 0 {
			unitario = jsmath.Round(float64((partes.Neto/l.Cantidad)*10000)) / 10000
		}
		out.Lineas = append(out.Lineas, LineaCalculada{
			Descripcion: l.Descripcion, Unidad: unidad, Cantidad: l.Cantidad, PrecioFinalUnitario: l.PrecioFinalUnitario,
			Alicuota: alicuota, PrecioUnitarioNeto: unitario, Neto: partes.Neto, Iva: partes.Iva, Subtotal: partes.Total,
		})
		iva += partes.Iva
		total += partes.Total
		if alicuota > 0 {
			neto += partes.Neto
			i := -1
			for j, x := range out.IvaPorAlicuota {
				if x.Alicuota == alicuota {
					i = j
					break
				}
			}
			if i < 0 {
				out.IvaPorAlicuota = append(out.IvaPorAlicuota, IvaDeAlicuota{Alicuota: alicuota})
				i = len(out.IvaPorAlicuota) - 1
			}
			a := &out.IvaPorAlicuota[i]
			a.Base = Redondear(a.Base + partes.Neto)
			a.Importe = Redondear(a.Importe + partes.Iva)
		} else {
			exento += partes.Neto
		}
	}
	out.Neto = Redondear(neto)
	out.Iva = Redondear(iva)
	out.Exento = Redondear(exento)
	out.Total = Redondear(total)
	return out
}

// SinImpuestosNacionales es el neto para la leyenda de la ley 27.743.
func SinImpuestosNacionales(precioFinal, alicuota float64) float64 {
	return Desagregar(precioFinal, alicuota).Neto
}
