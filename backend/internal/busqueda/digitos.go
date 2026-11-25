// Package busqueda tiene lo que comparten los buscadores del panel.
package busqueda

import (
	"strings"
	"unicode"
)

// Numero dice si lo que se busca es un número —un teléfono o un CUIT— y
// devuelve solo sus dígitos. Un teléfono se escribe de mil maneras («223
// 555-1234», «2235551234», «+54 9 223…») y el texto tal cual no encontraba
// la ficha: hay que comparar los dígitos de los dos lados.
//
// Cuenta como número lo que no tiene letras y trae al menos seis dígitos
// (menos que eso es una parte de un nombre o un código corto).
func Numero(texto string) (string, bool) {
	var b strings.Builder
	for _, r := range texto {
		switch {
		case unicode.IsDigit(r):
			b.WriteRune(r)
		case unicode.IsLetter(r):
			return "", false
		}
	}
	d := b.String()
	if len(d) < 6 {
		return "", false
	}
	return d, true
}

// Digitos es la expresión SQL con los dígitos de una columna de texto.
func Digitos(columna string) string {
	return "regexp_replace(coalesce(" + columna + ", ''), '\\D', '', 'g')"
}

// SinPrefijos saca del teléfono buscado lo que se escribe o no según quién
// lo anote: el 54 del país, el 9 de celular, el 0 de larga distancia y el 15.
// Lo que queda —característica y número— es lo que hay que encontrar.
func SinPrefijos(d string) string {
	d = strings.TrimPrefix(d, "54")
	d = strings.TrimPrefix(d, "9")
	d = strings.TrimPrefix(d, "0")
	return d
}
