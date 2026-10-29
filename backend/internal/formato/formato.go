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

// redondearDecimal redondea un número a d decimales como Intl.NumberFormat:
// sobre su representación decimal más corta (la de String(n)), con la mitad
// hacia arriba. Por eso (1.005).toLocaleString da «1,01» y (1.005).toFixed(2)
// da «1.00»: toFixed mira el valor binario exacto (1.00499…). Devuelve la
// parte entera y la decimal, sin signo.
func redondearDecimal(v float64, d int) (entero, dec string) {
	s := strconv.FormatFloat(math.Abs(v), 'f', -1, 64)
	e, f, _ := strings.Cut(s, ".")
	if len(f) <= d {
		return e, f + strings.Repeat("0", d-len(f))
	}
	sube := f[d] >= '5'
	digitos := []byte(e + f[:d])
	if sube {
		i := len(digitos) - 1
		for ; i >= 0; i-- {
			if digitos[i] == '9' {
				digitos[i] = '0'
				continue
			}
			digitos[i]++
			break
		}
		if i < 0 {
			digitos = append([]byte{'1'}, digitos...)
		}
	}
	return string(digitos[:len(digitos)-d]), string(digitos[len(digitos)-d:])
}

// Moneda es toLocaleString("es-AR", { style: "currency", currency: "ARS" }):
// «$ 1.234,56» (con espacio duro), «-$ 1.234,50»; el -0 lleva signo.
func Moneda(v float64) string {
	e, d := redondearDecimal(v, 2)
	signo := ""
	if math.Signbit(v) {
		signo = "-"
	}
	return signo + "$ " + Miles(e) + "," + d
}

// Numero es toLocaleString("es-AR") sin opciones: hasta tres decimales, sin
// ceros al final («1.234,568», «0,5»).
func Numero(v float64) string {
	e, d := redondearDecimal(v, 3)
	d = strings.TrimRight(d, "0")
	signo := ""
	if math.Signbit(v) {
		signo = "-"
	}
	t := Miles(e)
	if d != "" {
		t += "," + d
	}
	return signo + t
}

// MonedaEntera es Intl con currency ARS y maximumFractionDigits 0:
// «$ 1.235», «-$ 5».
func MonedaEntera(v float64) string {
	e, _ := redondearDecimal(v, 0)
	signo := ""
	if math.Signbit(v) {
		signo = "-"
	}
	return signo + "$ " + Miles(e)
}
