// Package precios es la gestión de precios del panel: editar uno, el ajuste
// masivo, la importación de planillas, las listas derivadas, los descuentos
// por medio de pago y la exportación. Era app/admin/precios y
// lib/dal/admin/precios.ts.
package precios

import (
	"math"
	"regexp"
	"strings"

	"mjbj/internal/jsmath"
)

// Las cuentas, copiadas del TS con su aritmética de float64 (ver el golden en
// testdata/golden/precios).

// Ajustar es ajustar() del ajuste masivo: la base por el factor, a centavos,
// y si hay redondeo, hacia arriba a la decena, la centena o el mil.
func Ajustar(base, factor float64, modo string) float64 {
	con := jsmath.Round(float64(base*factor)*100) / 100
	switch modo {
	case "decena":
		return math.Ceil(con/10) * 10
	case "centena":
		return math.Ceil(con/100) * 100
	case "mil":
		return math.Ceil(con/1000) * 1000
	}
	return con
}

// Factor es 1 + porcentaje/100.
func Factor(porcentaje float64) float64 { return 1 + porcentaje/100 }

// CostoElaborado es el costo promedio con el recargo de elaboración del
// producto, a centavos (la base de «recalcular desde el costo con
// elaboración»).
func CostoElaborado(costo float64, recargo *float64) float64 {
	r := 0.0
	if recargo != nil {
		r = *recargo
	}
	return jsmath.Round(float64(costo*(1+r/100))*100) / 100
}

// Brecha es cuánto más barata es la profesional que la general, en % con un
// decimal; nil si alguna no tiene precio.
func Brecha(general, profesional float64) *float64 {
	if !(general > 0 && profesional > 0) {
		return nil
	}
	b := jsmath.Round(float64((1-profesional/general)*1000)) / 10
	return &b
}

var reMiles = regexp.MustCompile(`^-?\d{1,3}\.\d{3}$`)

// ParsearImporte es parsearImporte (lib/formato.ts): entiende «1.234,56»,
// «1.234» (miles) y «12.34» (decimal). NaN si no es un número.
func ParsearImporte(texto string) float64 {
	limpio := strings.Join(strings.Fields(texto), "")
	if limpio == "" {
		return math.NaN()
	}
	if strings.Contains(limpio, ",") {
		return jsmath.Numero(strings.Replace(strings.ReplaceAll(limpio, ".", ""), ",", ".", 1))
	}
	switch puntos := strings.Count(limpio, "."); {
	case puntos > 1:
		return jsmath.Numero(strings.ReplaceAll(limpio, ".", ""))
	case puntos == 1 && reMiles.MatchString(limpio):
		return jsmath.Numero(strings.Replace(limpio, ".", "", 1))
	}
	return jsmath.Numero(limpio)
}

// PorcentajeDeAjuste es el esquema del ajuste masivo: z.coerce.number() entre
// −90 y 500, distinto de cero. Devuelve el número o el mensaje de zod.
func PorcentajeDeAjuste(texto string) (float64, string) {
	n := jsmath.Numero(texto)
	switch {
	case math.IsNaN(n):
		return 0, "Invalid input: expected number, received NaN"
	case n < -90:
		return 0, "No se puede bajar más de 90%."
	case n > 500:
		return 0, "Un aumento mayor a 500% seguramente sea un error de tipeo."
	case n == 0:
		return 0, "Poné un porcentaje distinto de cero."
	}
	return n, ""
}

// PorcentajeDeLista es el de una lista derivada: entre −50 y 50.
func PorcentajeDeLista(texto string) (float64, string) {
	n := jsmath.Numero(texto)
	switch {
	case math.IsNaN(n):
		return 0, "Invalid input: expected number, received NaN"
	case n < -50:
		return 0, "Too small: expected number to be >=-50"
	case n > 50:
		return 0, "Too big: expected number to be <=50"
	}
	return n, ""
}
