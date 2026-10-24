// Package jsmath hace las cuentas de plata exactamente como las hacía el
// TypeScript: en float64 (que es lo que es un `number` de JS) y con el
// redondeo de `Math.round`.
//
// **No es una librería decimal, a propósito.** La mudanza tiene que dar los
// mismos importes que daba el sistema en TypeScript, centavo por centavo:
// facturas, saldos de cuenta corriente, retenciones. Con decimales exactos
// `redondear(1.005)` da 1.01; en JS da 1.00. Una diferencia así no es un
// error de ninguno de los dos, pero rompe la comparación con lo ya emitido.
// Pasarse a decimal se puede hacer después del lanzamiento, como cambio
// propio y con sus pruebas.
//
// **Cuidado con x*y+z.** En arm64 (las Mac) el compilador de Go puede fusionar
// una multiplicación y una suma en una sola instrucción (FMA), que redondea
// una vez en vez de dos y da otro resultado que JS. Se escribe
// `float64(x*y) + z`: la conversión explícita obliga a redondear el producto.
package jsmath

import "math"

// Epsilon es Number.EPSILON.
const Epsilon = 2.220446049250313e-16

// Round es Math.round de JS: la mitad redondea hacia +∞ (Math.round(-2.5) es
// -2, no -3 como math.Round de Go), y conserva el -0.
func Round(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	piso := math.Floor(x)
	// x - piso es exacto (Sterbenz): no hay que sumar 0.5 y redondear dos
	// veces, que es donde floor(x+0.5) se equivoca con 0.49999999999999994.
	r := piso
	if x-piso >= 0.5 {
		r = piso + 1
	}
	if r == 0 && math.Signbit(x) {
		return math.Copysign(0, -1)
	}
	return r
}

// Redondear2 es `Math.round(n * 100) / 100`: el `aCentavos` del mostrador y
// de los cobros (lib/mostrador/importes.ts, lib/cobros/partes.ts).
func Redondear2(n float64) float64 {
	return Round(float64(n*100)) / 100
}

// Redondear2Eps es `Math.round((valor + Number.EPSILON) * 100) / 100`: el
// `redondear` de lo fiscal (lib/fiscal/impuestos.ts).
func Redondear2Eps(n float64) float64 {
	return Round(float64((n+Epsilon)*100)) / 100
}
