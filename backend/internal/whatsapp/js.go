package whatsapp

import (
	"math"
	"strconv"
	"strings"

	"mjbj/internal/jsmath"
)

// Lo que hace JavaScript con los textos y que Go hace distinto. La bandeja
// guarda y muestra lo mismo que guardaba el TS: los recortes cuentan unidades
// UTF-16 (un emoji son dos), y `trim()` y `\s` no son los de Go.

// esEspacioJS es lo que JS entiende por espacio en `trim()` y en `\s`: cuenta
// el BOM (U+FEFF) y no el NEL (U+0085), al revés que unicode.IsSpace.
func esEspacioJS(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// claseEspacioJS es `\s` de JS para armar expresiones regulares de Go.
const claseEspacioJS = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// trimJS es String.prototype.trim.
func trimJS(s string) string { return strings.TrimFunc(s, esEspacioJS) }

// largoJS es `.length`: unidades UTF-16.
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

// cortarJS es `.slice(0, n)`. Si el corte parte un emoji en dos, JS deja
// medio par suelto, y al guardarlo en la base (UTF-8) queda U+FFFD: eso es lo
// que se devuelve, para que la base quede igual que con el TS.
func cortarJS(s string, n int) string {
	if n <= 0 {
		return ""
	}
	usadas := 0
	for i, r := range s {
		ancho := 1
		if r >= 0x10000 {
			ancho = 2
		}
		if usadas+ancho > n {
			if ancho == 2 && usadas+1 == n {
				return s[:i] + "�"
			}
			return s[:i]
		}
		usadas += ancho
	}
	return s
}

// primeraPalabraJS es `texto.trim().split(/\s+/)[0]`.
func primeraPalabraJS(s string) string {
	s = trimJS(s)
	if i := strings.IndexFunc(s, esEspacioJS); i >= 0 {
		return s[:i]
	}
	return s
}

// colapsarEspaciosJS es `.replace(/\s+/g, " ")`.
func colapsarEspaciosJS(s string) string {
	var b strings.Builder
	enEspacio := false
	for _, r := range s {
		if esEspacioJS(r) {
			if !enEspacio {
				b.WriteByte(' ')
			}
			enEspacio = true
			continue
		}
		enEspacio = false
		b.WriteRune(r)
	}
	return b.String()
}

// numeroJS es Number(x) de un valor que vino en un JSON: null es 0, un
// booleano es 0 o 1, un texto se lee como lo lee JS y un objeto es NaN.
func numeroJS(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case bool:
		if x {
			return 1
		}
		return 0
	case float64:
		return x
	case string:
		t := trimJS(x)
		if strings.ContainsRune(t, 0x85) {
			return math.NaN()
		}
		return jsmath.Numero(t)
	case []any:
		switch len(x) {
		case 0:
			return 0
		case 1:
			return numeroJS(textoDeArreglo(x[0]))
		}
	}
	return math.NaN()
}

// textoDeArreglo es lo que da String([x]) para un elemento: lo que usa
// Number([x]).
func textoDeArreglo(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return jsmath.Texto(x)
	case bool:
		return strconv.FormatBool(x)
	case []any:
		partes := make([]string, len(x))
		for i, e := range x {
			partes[i] = textoDeArreglo(e)
		}
		return strings.Join(partes, ",")
	}
	return "[object Object]"
}

// encodeURIComponent de JS.
func encodeURIComponent(s string) string {
	const sinCodificar = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if strings.IndexByte(sinCodificar, c) >= 0 {
			b.WriteByte(c)
			continue
		}
		b.WriteString("%" + strings.ToUpper(strconv.FormatUint(uint64(c)>>4, 16)) + strings.ToUpper(strconv.FormatUint(uint64(c)&15, 16)))
	}
	return b.String()
}

// mayusculasJS es `.toUpperCase()` (los casos que cambian de largo, como la
// ß, también: Go deja la ß como está).
func mayusculasJS(s string) string {
	if !strings.ContainsRune(s, 'ß') {
		return strings.ToUpper(s)
	}
	return strings.ToUpper(strings.ReplaceAll(s, "ß", "SS"))
}
