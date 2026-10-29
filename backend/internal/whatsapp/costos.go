package whatsapp

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
)

// Cuánto se gasta en Meta y cuándo se corta (lib/whatsapp/costos.ts). Desde
// el 1/10/2026 Meta cobra cada mensaje que sale por la Cloud API; lo que sale
// de la app del teléfono es gratis. El número sale del cobro que Meta informa
// en cada estado, y lo que salió y todavía no tiene estado se cuenta como
// estimado.

// CategoriasCobro son las categorías de Meta que cobran, en el orden del TS.
var CategoriasCobro = []string{"utility", "service", "marketing", "authentication"}

// NombreCategoria es cómo se muestra cada una.
var NombreCategoria = map[string]string{
	"utility":        "Utilidad (avisos)",
	"service":        "Servicio (respuestas)",
	"marketing":      "Promoción",
	"authentication": "Verificación",
}

// TarifasPorOmision son los USD por mensaje a un número argentino desde el 1/10/2026.
var TarifasPorOmision = map[string]float64{
	"utility":        0.026,
	"service":        0.026,
	"marketing":      0.0618,
	"authentication": 0.026,
}

// TopePorOmision es el tope del mes si nadie lo cambió, en USD.
const TopePorOmision = 10.0

// Umbrales son los porcentajes del tope en los que se avisa al admin.
var Umbrales = []int{80, 100}

// MotivoTope es lo que queda en la bitácora cuando un aviso no sale por el tope.
const MotivoTope = "Tope mensual de WhatsApp alcanzado: no salió por la API."

// CategoriaDeTarifa es la categoría de tarifa de lo que informa Meta, o ""
// si no se cobra nunca (`referral_conversion`). Lo desconocido, servicio.
func CategoriaDeTarifa(categoria *string) string {
	c := ""
	if categoria != nil {
		c = strings.ToLower(*categoria)
	}
	switch {
	case c == "referral_conversion":
		return ""
	case strings.HasPrefix(c, "marketing"):
		return "marketing"
	case strings.HasPrefix(c, "authentication"):
		return "authentication"
	case strings.HasPrefix(c, "utility"):
		return "utility"
	}
	return "service"
}

// TarifasEfectivas son las guardadas, completadas con las de siempre y sin
// valores raros.
func TarifasEfectivas(guardadas map[string]any) map[string]float64 {
	t := map[string]float64{}
	for k, v := range TarifasPorOmision {
		t[k] = v
	}
	for _, c := range CategoriasCobro {
		v, ok := guardadas[c]
		var n float64
		if !ok {
			n = math.NaN()
		} else {
			n = numeroJS(v)
		}
		if !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n < 10 {
			t[c] = n
		}
	}
	return t
}

// FilaDeGasto es un grupo de mensajes del mes.
type FilaDeGasto struct {
	Categoria *string `json:"categoria"`
	Cobrable  *bool   `json:"cobrable"`
	Total     float64 `json:"total"`
	Estimado  bool    `json:"estimado,omitempty"`
}

// DetalleCategoria es lo de una categoría.
type DetalleCategoria struct {
	Gratis    int     `json:"gratis"`
	Cobrados  int     `json:"cobrados"`
	Estimados int     `json:"estimados"`
	USD       float64 `json:"usd"`
}

// Gasto es la cuenta del mes.
type Gasto struct {
	USD           float64                      `json:"usd"`
	USDConfirmado float64                      `json:"usdConfirmado"`
	USDEstimado   float64                      `json:"usdEstimado"`
	PorCategoria  map[string]*DetalleCategoria `json:"porCategoria"`
}

func redondo4(n float64) float64 { return jsmath.Round(float64(n*10_000)) / 10_000 }

// CalcularGasto suma lo que se gasta en el mes con lo que hay registrado.
func CalcularGasto(filas []FilaDeGasto, tarifas map[string]float64) Gasto {
	por := map[string]*DetalleCategoria{}
	for _, c := range CategoriasCobro {
		por[c] = &DetalleCategoria{}
	}
	confirmado, estimado := 0.0, 0.0
	for _, f := range filas {
		categoria := CategoriaDeTarifa(f.Categoria)
		total := f.Total
		if math.IsNaN(total) {
			total = 0
		}
		cantidad := max(0, math.Floor(total))
		if categoria == "" || cantidad == 0 {
			continue
		}
		d := por[categoria]
		switch {
		case f.Estimado:
			d.Estimados += int(cantidad)
			usd := float64(cantidad * tarifas[categoria])
			d.USD = float64(d.USD + usd)
			estimado = float64(estimado + usd)
		case f.Cobrable != nil && *f.Cobrable:
			d.Cobrados += int(cantidad)
			usd := float64(cantidad * tarifas[categoria])
			d.USD = float64(d.USD + usd)
			confirmado = float64(confirmado + usd)
		default:
			d.Gratis += int(cantidad)
		}
	}
	for _, c := range CategoriasCobro {
		por[c].USD = redondo4(por[c].USD)
	}
	return Gasto{
		USD:           redondo4(float64(confirmado + estimado)),
		USDConfirmado: redondo4(confirmado),
		USDEstimado:   redondo4(estimado),
		PorCategoria:  por,
	}
}

// EstadoDelTope es dónde está el gasto respecto del tope.
type EstadoDelTope struct {
	Proporcion float64 `json:"proporcion"`
	Alcanzado  bool    `json:"alcanzado"`
	// Umbral es el más alto que se pasó (80 o 100), o nil.
	Umbral *int `json:"umbral"`
}

// EstadoDeTope es estadoDelTope. Un tope de cero es «por la API, nada».
func EstadoDeTope(usd, tope float64) EstadoDelTope {
	if !(tope > 0) {
		cien := 100
		return EstadoDelTope{1, true, &cien}
	}
	p := usd / tope
	var umbral *int
	for i := len(Umbrales) - 1; i >= 0; i-- {
		if float64(p*100) >= float64(Umbrales[i]) {
			u := Umbrales[i]
			umbral = &u
			break
		}
	}
	return EstadoDelTope{p, usd >= tope, umbral}
}

// UmbralesPasados son los que ya se pasaron, del más bajo al más alto.
func UmbralesPasados(usd, tope float64) []int {
	e := EstadoDeTope(usd, tope)
	out := []int{}
	for _, u := range Umbrales {
		if float64(e.Proporcion*100) >= float64(u) {
			out = append(out, u)
		}
	}
	return out
}

var zonaArgentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// MesArgentino es «2026-10»: la clave del mes en Argentina.
func MesArgentino(t time.Time) string {
	l := t.In(zonaArgentina)
	return fmt.Sprintf("%04d-%02d", l.Year(), int(l.Month()))
}

// InicioDelMesArgentino es el instante en que empezó el mes en Argentina
// (las 03:00 UTC del día 1: UTC−3 todo el año).
func InicioDelMesArgentino(t time.Time) time.Time {
	l := t.In(zonaArgentina)
	return time.Date(l.Year(), l.Month(), 1, 3, 0, 0, 0, time.UTC)
}

// InicioDelMesSiguienteArgentino es cuándo vuelven los avisos.
func InicioDelMesSiguienteArgentino(t time.Time) time.Time {
	l := t.In(zonaArgentina)
	return time.Date(l.Year(), l.Month()+1, 1, 3, 0, 0, 0, time.UTC)
}

// Dolares es «USD 3,12».
func Dolares(usd float64) string { return "USD " + numeroEsAR(usd, 2, 2) }

// TarifaLegible es «USD 0,026».
func TarifaLegible(usd float64) string { return "USD " + numeroEsAR(usd, 2, 4) }

// numeroEsAR es `toLocaleString("es-AR", {min, max})`: Intl redondea el
// decimal más corto que representa al número (1.005 → «1,01», donde toFixed
// daría 1,00), la mitad lejos del cero.
func numeroEsAR(v float64, minDec, maxDec int) string {
	if math.IsNaN(v) {
		return "NaN"
	}
	signo := ""
	if v < 0 {
		signo, v = "-", -v
	}
	entero, dec := redondearDecimal(strconv.FormatFloat(v, 'f', -1, 64), maxDec)
	for len(dec) > minDec && strings.HasSuffix(dec, "0") {
		dec = dec[:len(dec)-1]
	}
	for len(dec) < minDec {
		dec += "0"
	}
	s := signo + formato.Miles(entero)
	if dec != "" {
		s += "," + dec
	}
	return s
}

// redondearDecimal redondea un decimal escrito («2.675») a `n` decimales, la
// mitad hacia arriba.
func redondearDecimal(s string, n int) (string, string) {
	entero, dec, _ := strings.Cut(s, ".")
	if len(dec) <= n {
		return entero, dec
	}
	sube := dec[n] >= '5'
	digitos := []byte(entero + dec[:n])
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
	ent := string(digitos[:len(digitos)-n])
	return ent, string(digitos[len(digitos)-n:])
}

// Moneda es `moneda.format(n)` de lib/formato.ts: pesos sin decimales al
// estilo es-AR («$ 84.500», con espacio duro; «-$ 1.235»). Como Intl, un
// negativo que redondea a cero conserva el signo («-$ 0»).
func Moneda(v float64) string {
	if math.IsNaN(v) {
		return "NaN"
	}
	signo := ""
	if v < 0 {
		signo, v = "-", -v
	}
	entero, _ := redondearDecimal(strconv.FormatFloat(v, 'f', -1, 64), 0)
	return signo + "$ " + formato.Miles(entero)
}
