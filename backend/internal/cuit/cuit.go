// Package cuit copia lib/cuit.ts: el CUIT y el DNI argentinos.
package cuit

import (
	"regexp"
	"strings"
)

var pesos = [10]int{5, 4, 3, 2, 7, 6, 5, 4, 3, 2}

var prefijos = map[string]bool{"20": true, "23": true, "24": true, "25": true, "26": true, "27": true, "30": true, "33": true, "34": true}

var noDigito = regexp.MustCompile(`\D`)

// SoloDigitos saca todo lo que no sea un dígito (0-9).
func SoloDigitos(s string) string { return noDigito.ReplaceAllString(s, "") }

// DigitoVerificador es el que corresponde a los primeros diez dígitos; -1 si
// no son diez.
func DigitoVerificador(diez string) int {
	if len(diez) != 10 {
		return -1
	}
	suma := 0
	for i := 0; i < 10; i++ {
		suma += int(diez[i]-'0') * pesos[i]
	}
	switch resto := suma % 11; resto {
	case 0:
		return 0
	case 1:
		if strings.HasPrefix(diez, "2") {
			return 9
		}
		return 4
	default:
		return 11 - resto
	}
}

func todosIguales(d string) bool {
	return len(d) > 0 && strings.Count(d, d[:1]) == len(d)
}

// Valido: once dígitos, no todos iguales, un prefijo conocido y el
// verificador que corresponde.
func Valido(c string) bool {
	d := SoloDigitos(c)
	if len(d) != 11 || todosIguales(d) || !prefijos[d[:2]] {
		return false
	}
	return DigitoVerificador(d[:10]) == int(d[10]-'0')
}

// FormatearLargo es «30-58944525-9»; si no tiene once dígitos, lo deja igual.
func FormatearLargo(c string) string {
	d := SoloDigitos(c)
	if len(d) != 11 {
		return c
	}
	return d[:2] + "-" + d[2:10] + "-" + d[10:]
}

// Variantes son las dos formas en que puede estar guardado.
func Variantes(c string) []string {
	d := SoloDigitos(c)
	if len(d) != 11 {
		return []string{c}
	}
	return []string{d, FormatearLargo(d)}
}

// DniValido: siete u ocho dígitos, no todos iguales.
func DniValido(dni string) bool {
	d := SoloDigitos(dni)
	if len(d) < 7 || len(d) > 8 {
		return false
	}
	return !todosIguales(d)
}
