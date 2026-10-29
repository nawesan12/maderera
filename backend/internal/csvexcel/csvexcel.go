// Package csvexcel es lib/csv-excel.ts: el CSV para Excel en español de las
// exportaciones (libro IVA compras, cierre de caja, pagos a proveedores, y
// las que vengan). Punto y coma, coma decimal y BOM adelante: sin el BOM
// «Melamínica» llega como «MelamÃ­nica».
//
// Lo usan las tandas que mudan esas exportaciones (ARCA, caja, compras);
// queda listo en la tanda 12 con golden contra el TS.
package csvexcel

import (
	"math"
	"strconv"
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// textoJS es String(n) de JS, con NaN e Infinity escritos como en JS.
func textoJS(n float64) string {
	switch {
	case math.IsNaN(n):
		return "NaN"
	case math.IsInf(n, 1):
		return "Infinity"
	case math.IsInf(n, -1):
		return "-Infinity"
	}
	return jsmath.Texto(n)
}

// NumeroCsv es numeroCsv: un importe con coma decimal (toFixed de JS).
func NumeroCsv(valor float64, decimales int) string {
	var t string
	switch {
	case math.IsInf(valor, 0):
		t = textoJS(valor)
	default:
		t = jsmath.ToFixed(valor, decimales)
	}
	return strings.Replace(t, ".", ",", 1)
}

// EnteroCsv es enteroCsv: String(Math.round(valor)).
func EnteroCsv(valor float64) string {
	if math.IsNaN(valor) || math.IsInf(valor, 0) {
		return textoJS(valor)
	}
	return textoJS(jsmath.Round(valor))
}

// TextoCsv es textoCsv: entre comillas, con las de adentro duplicadas. nil
// es como null.
func TextoCsv(valor *string) string {
	if valor == nil {
		return `""`
	}
	return `"` + strings.ReplaceAll(*valor, `"`, `""`) + `"`
}

// Texto es TextoCsv de un texto que siempre está.
func Texto(valor string) string { return TextoCsv(&valor) }

var argentina = func() *time.Location {
	if l, err := time.LoadLocation("America/Argentina/Buenos_Aires"); err == nil {
		return l
	}
	return time.FixedZone("ART", -3*60*60)
}()

// FechaCsv es fechaCsv: «dd/mm/aaaa», o vacío si no hay fecha.
//
// El TS usa la zona del proceso, y el contenedor de Next corre en UTC: un
// pago de las 22 salía con la fecha del día siguiente. Go la escribe en la
// hora argentina.
func FechaCsv(valor *time.Time) string {
	if valor == nil {
		return ""
	}
	t := valor.In(argentina)
	return pad2(t.Day()) + "/" + pad2(int(t.Month())) + "/" + strconv.Itoa(t.Year())
}

func pad2(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

// ArmarCsv es armarCsv: los encabezados entre comillas, las filas ya
// formateadas, los totales si hay, con CRLF y el BOM.
func ArmarCsv(encabezados []string, filas [][]string, totales []string) string {
	var b strings.Builder
	b.WriteString("\ufeff")
	for i, e := range encabezados {
		if i > 0 {
			b.WriteByte(';')
		}
		b.WriteString(Texto(e))
	}
	for _, f := range filas {
		b.WriteString("\r\n")
		b.WriteString(strings.Join(f, ";"))
	}
	if totales != nil {
		b.WriteString("\r\n")
		b.WriteString(strings.Join(totales, ";"))
	}
	b.WriteString("\r\n")
	return b.String()
}

// Cabeceras son las de cabecerasCsv: el tipo, el nombre del archivo y que no
// se guarde en ninguna caché.
func Cabeceras(nombre string) map[string]string {
	return map[string]string{
		"Content-Type":        "text/csv; charset=utf-8",
		"Content-Disposition": `attachment; filename="` + nombre + `"`,
		"Cache-Control":       "private, no-store",
	}
}
