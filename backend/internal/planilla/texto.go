package planilla

import (
	"math"
	"math/big"
	"strings"
	"unicode/utf8"

	"mjbj/internal/jsmath"
)

// Lo que JS entiende por espacio en `trim()` y en `\s` de una expresión
// regular: no es lo mismo que unicode.IsSpace de Go. JS cuenta el BOM
// (U+FEFF) y no cuenta el NEL (U+0085); Go, al revés.
func esEspacioJS(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

func esFinito(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }

// trimJS es String.prototype.trim.
func trimJS(s string) string {
	return strings.TrimFunc(s, esEspacioJS)
}

// numeroJS es Number(texto). jsmath.Numero recorta con strings.TrimSpace,
// que se come un NEL que JS deja (y con el que JS da NaN).
func numeroJS(s string) float64 {
	t := trimJS(s)
	if strings.HasPrefix(t, "\u0085") || strings.HasSuffix(t, "\u0085") {
		return math.NaN()
	}
	return jsmath.Numero(t)
}

// toFixed2 es Number.prototype.toFixed(2): redondeo exacto del valor binario,
// y en el empate gana el entero más grande (strconv redondea al par: 0.125
// daría "0.12"; JS da "0.13"). Desde 1e21 JS pasa a String(n).
func toFixed2(x float64) string {
	if math.IsNaN(x) {
		return "NaN"
	}
	if math.Abs(x) >= 1e21 || math.IsInf(x, 0) {
		return jsmath.Texto(x)
	}
	signo := ""
	if x < 0 {
		signo = "-"
		x = -x
	}
	v := new(big.Float).SetPrec(256).SetFloat64(x)
	v.Mul(v, big.NewFloat(100))
	v.Add(v, big.NewFloat(0.5))
	n, _ := v.Int(nil) // v >= 0: truncar es el piso
	digitos := n.String()
	for len(digitos) < 3 {
		digitos = "0" + digitos
	}
	return signo + digitos[:len(digitos)-2] + "." + digitos[len(digitos)-2:]
}

// decodificarUTF8 es `new TextDecoder().decode(bytes)`: UTF-8 no estricto con
// el reemplazo del estándar WHATWG (una secuencia cortada es un solo U+FFFD,
// no uno por byte como en Go) y sin el BOM del principio.
func decodificarUTF8(b []byte) string {
	var sb strings.Builder
	sb.Grow(len(b))
	var (
		cp                 rune
		faltan, vistos     int
		inferior, superior byte = 0x80, 0xbf
		escribirReemplazo       = func() { sb.WriteRune(utf8.RuneError) }
	)
	for i := 0; i < len(b); i++ {
		c := b[i]
		if faltan == 0 {
			switch {
			case c <= 0x7f:
				sb.WriteByte(c)
			case c >= 0xc2 && c <= 0xdf:
				faltan, cp = 1, rune(c&0x1f)
			case c >= 0xe0 && c <= 0xef:
				if c == 0xe0 {
					inferior = 0xa0
				}
				if c == 0xed {
					superior = 0x9f
				}
				faltan, cp = 2, rune(c&0xf)
			case c >= 0xf0 && c <= 0xf4:
				if c == 0xf0 {
					inferior = 0x90
				}
				if c == 0xf4 {
					superior = 0x8f
				}
				faltan, cp = 3, rune(c&0x7)
			default:
				escribirReemplazo()
			}
			continue
		}
		if c < inferior || c > superior {
			cp, faltan, vistos = 0, 0, 0
			inferior, superior = 0x80, 0xbf
			escribirReemplazo()
			i-- // el byte se vuelve a mirar como comienzo
			continue
		}
		inferior, superior = 0x80, 0xbf
		cp = cp<<6 | rune(c&0x3f)
		vistos++
		if vistos == faltan {
			sb.WriteRune(cp)
			cp, faltan, vistos = 0, 0, 0
		}
	}
	if faltan != 0 {
		escribirReemplazo()
	}
	return strings.TrimPrefix(sb.String(), bom)
}

// windows1252 es el índice del estándar WHATWG para 0x80–0x9F (lo que usa
// TextDecoder("windows-1252")); el resto de los bytes es Latin-1. Los cinco
// huecos (0x81, 0x8D, 0x8F, 0x90, 0x9D) quedan como controles C1.
var windows1252 = [32]rune{
	0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
	0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
	0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
	0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
}

func decodificarWindows1252(b []byte) string {
	var sb strings.Builder
	sb.Grow(len(b) + len(b)/4)
	for _, c := range b {
		switch {
		case c < 0x80:
			sb.WriteByte(c)
		case c < 0xa0:
			sb.WriteRune(windows1252[c-0x80])
		default:
			sb.WriteRune(rune(c))
		}
	}
	return sb.String()
}
