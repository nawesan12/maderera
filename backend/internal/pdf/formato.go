package pdf

import (
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
)

// Los formatos de lib/formato.ts que usan los documentos. Los golden de
// formato_test.go los comparan con Intl de Node.

// Moneda es moneda.format() de lib/formato.ts: pesos sin decimales al estilo
// es-AR, con espacio duro («$ 1.235», «-$ 0»). Intl redondea la mitad hacia
// afuera, como math.Round, y muestra el signo también en el -0.
func Moneda(v float64) string {
	if math.IsNaN(v) {
		return "$ NaN"
	}
	signo := ""
	if math.Signbit(v) {
		signo = "-"
	}
	a := math.Abs(v)
	if math.IsInf(a, 0) {
		return signo + "$ ∞"
	}
	return signo + "$ " + formato.Miles(strconv.FormatFloat(math.Round(a), 'f', 0, 64))
}

// MonedaDe es moneda.format(Number(texto)) para un importe que llega como
// texto de la base.
func MonedaDe(texto string) string { return Moneda(jsmath.Numero(texto)) }

// Argentina es la hora de los documentos.
//
// El TS formatea con la zona del proceso, y el contenedor de Next no tiene
// TZ: en producción las fechas «de hoy» salían en UTC, así que una lista
// bajada después de las 21 decía mañana, y la hora de la firma del remito
// salía tres horas corrida. Go las escribe siempre en la hora argentina.
var Argentina = func() *time.Location {
	if l, err := time.LoadLocation("America/Argentina/Buenos_Aires"); err == nil {
		return l
	}
	return time.FixedZone("ART", -3*60*60)
}()

// FechaLocal es toLocaleDateString("es-AR"): «5/3/2026», sin ceros.
func FechaLocal(t time.Time) string {
	t = t.In(Argentina)
	return strconv.Itoa(t.Day()) + "/" + strconv.Itoa(int(t.Month())) + "/" + strconv.Itoa(t.Year())
}

// FechaSolaCorta es fechaSolaCorta de lib/formato.ts: «05/03/26», en UTC
// (es para fechas que son un día y no un instante).
func FechaSolaCorta(t time.Time) string {
	return t.UTC().Format("02/01/06")
}

// FechaCortaHoy es fechaSolaCorta.format(new Date()): la fecha de hoy. Va
// en la hora argentina por lo mismo que FechaLocal.
func FechaCortaHoy(t time.Time) string {
	return t.In(Argentina).Format("02/01/06")
}

// FechaHora es fechaHora de lib/formato.ts («5/3, 12:04»: el ICU de es-AR
// no rellena el día y el mes aunque se le pida 2-digit), en hora argentina.
func FechaHora(t time.Time) string {
	t = t.In(Argentina)
	return strconv.Itoa(t.Day()) + "/" + strconv.Itoa(int(t.Month())) + ", " + t.Format("15:04")
}

// cortarJS es s.slice(0, n) de JS: por unidades de UTF-16. Una mitad de un
// par sustituto queda como U+FFFD, que Limpiar después borra (en el TS
// también se borra).
func cortarJS(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}

// largoJS es s.length de JS.
func largoJS(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// Unidad es formatearUnidad de lib/formato.ts.
func Unidad(u string) string {
	if u == "" {
		return "u."
	}
	if a, ok := abreviaturaUnidad[u]; ok {
		return a
	}
	return strings.ReplaceAll(u, "_", " ")
}

var abreviaturaUnidad = map[string]string{
	"unidad":         "u.",
	"metro_lineal":   "ml",
	"metro_cuadrado": "m²",
	"tabla":          "tabla",
	"placa":          "placa",
	"rollo":          "rollo",
	"par":            "par",
	"juego":          "juego",
	"kg":             "kg",
	"litro":          "l",
}

// Cuit es formatearCuit de lib/formato.ts.
func Cuit(cuit string) string {
	if cuit == "" {
		return "—"
	}
	var d strings.Builder
	for _, r := range cuit {
		if r >= '0' && r <= '9' {
			d.WriteRune(r)
		}
	}
	l := d.String()
	if len(l) != 11 {
		return cuit
	}
	return l[:2] + "-" + l[2:10] + "-" + l[10:]
}

// numeroJS es String(n) de JS.
func numeroJS(n float64) string { return jsmath.Texto(n) }
