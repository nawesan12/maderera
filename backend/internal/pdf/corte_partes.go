package pdf

import (
	"math"
	"strconv"
	"strings"

	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
)

// Lo que los PDF de cortes usan de lib/cortes (plano.ts, sierra.ts,
// secuencia.ts): los tipos del plano y de la hoja de corte, y dos cuentas.
//
// Son copias privadas a propósito: la tanda 11 (cortes) se muda en otra
// rama y va a tener su propio paquete. Cuando llegue, estos tipos y
// funciones se juntan con los de allá y el PDF pasa a recibir los suyos.

// LineaDeCorte es LineaDeCorte de lib/cortes/plano.ts.
type LineaDeCorte struct {
	Direccion string  `json:"direccion"` // "horizontal" | "vertical"
	X1        float64 `json:"x1"`
	Y1        float64 `json:"y1"`
	X2        float64 `json:"x2"`
	Y2        float64 `json:"y2"`
}

// PiezaColocada es PiezaColocada de lib/cortes/plano.ts.
type PiezaColocada struct {
	X             float64 `json:"x"`
	Y             float64 `json:"y"`
	Ancho         float64 `json:"ancho"`
	Alto          float64 `json:"alto"`
	Indice        float64 `json:"indice"`
	Unidad        float64 `json:"unidad"`
	Etiqueta      *string `json:"etiqueta"`
	Girada        bool    `json:"girada"`
	LargoOriginal float64 `json:"largoOriginal"`
	AnchoOriginal float64 `json:"anchoOriginal"`
}

// RectDeCorte es Recorte de plano.ts y Rect de secuencia.ts (los mismos
// cuatro números).
type RectDeCorte struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Ancho float64 `json:"ancho"`
	Alto  float64 `json:"alto"`
}

// PlacaDelPlano es PlacaDelPlano de lib/cortes/plano.ts (lo que usa el PDF).
type PlacaDelPlano struct {
	Numero        float64         `json:"numero"`
	Piezas        []PiezaColocada `json:"piezas"`
	Cortes        []LineaDeCorte  `json:"cortes"`
	Recortes      []RectDeCorte   `json:"recortes"`
	Aprovechado   float64         `json:"aprovechado"`
	SeVendeEntera bool            `json:"seVendeEntera"`
}

// PiezaQueNoEntra es un renglón de noEntran.
type PiezaQueNoEntra struct {
	Indice  float64 `json:"indice"`
	LargoMm float64 `json:"largoMm"`
	AnchoMm float64 `json:"anchoMm"`
}

// PlanoDeCorte es PlanoDeCorte de lib/cortes/plano.ts (lo que usa el PDF).
type PlanoDeCorte struct {
	PlacaLargo       float64           `json:"placaLargo"`
	PlacaAncho       float64           `json:"placaAncho"`
	AnchoSierra      float64           `json:"anchoSierra"`
	Placas           []PlacaDelPlano   `json:"placas"`
	NoEntran         []PiezaQueNoEntra `json:"noEntran"`
	TotalPiezas      float64           `json:"totalPiezas"`
	AprovechadoTotal float64           `json:"aprovechadoTotal"`
	Pasadas          float64           `json:"pasadas"`
}

// superficieDeSierra es superficieDeSierra de lib/cortes/plano.ts: lo que el
// disco se come de una placa, en mm².
func superficieDeSierra(placa PlacaDelPlano, anchoSierra float64) float64 {
	total := 0.0
	for _, c := range placa.Cortes {
		var largo float64
		if c.Direccion == "horizontal" {
			largo = math.Abs(c.X2 - c.X1)
		} else {
			largo = math.Abs(c.Y2 - c.Y1)
		}
		total = total + float64(largo*anchoSierra)
	}
	return total
}

// formatearSierra es formatearSierra de lib/cortes/sierra.ts: «4,4 mm».
func formatearSierra(mm float64) string { return intlUnDecimal(mm, true) + " mm" }

// intlUnDecimal es Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 })
// (con useGrouping: false si agrupar es falso). ICU no redondea el valor
// binario exacto sino su representación decimal más corta (la de String(n)),
// con la mitad hacia afuera: 12345.65 —que en binario es 12345,6499…— da
// «12.345,7». Acá igual: se parte de FormatFloat(-1) y se redondea el texto.
func intlUnDecimal(v float64, agrupar bool) string {
	if math.IsNaN(v) {
		return "NaN"
	}
	signo := ""
	if math.Signbit(v) {
		signo = "-"
	}
	a := math.Abs(v)
	if math.IsInf(a, 0) {
		return signo + "∞"
	}
	entero, dec, _ := strings.Cut(strconv.FormatFloat(a, 'f', -1, 64), ".")
	primero := byte('0')
	if dec != "" {
		primero = dec[0]
		if len(dec) > 1 && dec[1] >= '5' {
			// Sube un décimo: se suma con acarreo sobre los dígitos.
			digitos := []byte(entero + string(primero))
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
			entero, primero = string(digitos[:len(digitos)-1]), digitos[len(digitos)-1]
		}
	}
	if agrupar {
		entero = formato.Miles(entero)
	}
	if primero != '0' {
		return signo + entero + "," + string(primero)
	}
	return signo + entero
}

// metrosCorte es metros() de lib/pdf/corte.ts: dos decimales con coma.
func metrosCorte(v float64) string {
	return strings.Replace(jsmath.ToFixed(v, 2), ".", ",", 1)
}

// rectanguloConTrazo es drawRectangle con borderDashArray, que la base no
// tiene: lo mismo que DibujarRectangulo pero con «[3 2] 0 d». Como en
// pdf-lib, un `color: undefined` explícito no pone el relleno negro por
// omisión: acá nunca se rellena de oficio.
func (p *Pagina) rectanguloConTrazo(o Rectangulo, trazo []float64) {
	gs := p.estado(o.Opacidad, o.OpacidadBorde)
	p.op("q")
	if gs != "" {
		p.op("/"+gs, "gs")
	}
	if o.Relleno.definido {
		p.op(rg(o.Relleno), "rg")
	}
	if o.Borde.definido {
		p.op(rg(o.Borde), "RG")
	}
	p.op(num(o.Grosor), "w")
	partes := make([]string, len(trazo))
	for i, t := range trazo {
		partes[i] = num(t)
	}
	p.op("["+strings.Join(partes, " ")+"]", "0", "d")
	p.op("1 0 0 1", num(o.X), num(o.Y), "cm")
	p.op("1 0 0 1 0 0 cm")
	p.op("1 0 0 1 0 0 cm")
	p.op("0 0 m")
	p.op("0", num(o.Alto), "l")
	p.op(num(o.Ancho), num(o.Alto), "l")
	p.op(num(o.Ancho), "0", "l")
	p.op("h")
	switch {
	case o.Relleno.definido && o.Grosor != 0:
		p.op("B")
	case o.Relleno.definido:
		p.op("f")
	case o.Borde.definido:
		p.op("S")
	default:
		p.op("h")
	}
	p.op("Q")
}
