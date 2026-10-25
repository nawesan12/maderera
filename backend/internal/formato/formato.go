// Package formato copia lib/formato.ts: cómo se muestra la plata.
package formato

import (
	"math"

	"mjbj/internal/jsmath"
	"strconv"
	"strings"
)

// Precio es formatearPrecio: pesos sin decimales al estilo es-AR
// («$ 84.500», con espacio duro), o «A consultar» si no es un precio.
// Intl redondea la mitad hacia arriba, como math.Round para positivos.
func Precio(v float64) string {
	if math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
		return "A consultar"
	}
	return "$ " + Miles(strconv.FormatFloat(math.Round(v), 'f', 0, 64))
}

// PrecioONulo es Precio de un precio que puede faltar (null en el TS).
func PrecioONulo(v *float64) string {
	if v == nil {
		return "A consultar"
	}
	return Precio(*v)
}

// Miles pone los puntos de miles a una tira de dígitos.
func Miles(d string) string {
	if len(d) <= 3 {
		return d
	}
	var b strings.Builder
	primero := len(d) % 3
	if primero > 0 {
		b.WriteString(d[:primero])
	}
	for i := primero; i < len(d); i += 3 {
		if b.Len() > 0 {
			b.WriteByte('.')
		}
		b.WriteString(d[i : i+3])
	}
	return b.String()
}

// Cantidad es formatearCantidad (lib/unidades.ts): redondeada a 3 decimales
// como cantidadDeStock y con el formato es-AR («1.234,568», «-2,5»).
func Cantidad(v float64) string {
	v = jsmath.Round(v*1000) / 1000
	if v == 0 {
		return "0" // también el -0
	}
	signo := ""
	if v < 0 {
		signo, v = "-", -v
	}
	t := strconv.FormatFloat(v, 'f', 3, 64)
	entero, dec, _ := strings.Cut(t, ".")
	dec = strings.TrimRight(dec, "0")
	if dec != "" {
		dec = "," + dec
	}
	return signo + Miles(entero) + dec
}
