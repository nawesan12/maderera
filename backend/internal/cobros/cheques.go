package cobros

import (
	"regexp"
	"slices"
)

// Estado es el de un cheque (lib/cheques/estados.ts).
type Estado string

// Transiciones son los estados a los que puede pasar cada uno.
var Transiciones = map[Estado][]Estado{
	"informado":  {"cartera", "rechazado"},
	"cartera":    {"depositado", "entregado", "rechazado", "anulado"},
	"depositado": {"acreditado", "rechazado"},
	"entregado":  {"acreditado", "rechazado"},
	"acreditado": {},
	"rechazado":  {},
	"anulado":    {},
}

// PuedePasar de un estado a otro.
func PuedePasar(desde, hacia Estado) bool { return slices.Contains(Transiciones[desde], hacia) }

// Efecto es lo que le pasa a la cuenta del cliente: aceptar uno informado
// acredita (emite el recibo); rechazar uno que ya contaba, debita.
func Efecto(desde, hacia Estado) string {
	if desde == "informado" && hacia == "cartera" {
		return "acreditar"
	}
	if hacia == "rechazado" && desde != "informado" {
		return "debitar"
	}
	return "nada"
}

// ParaElCliente es cómo lo ve el cliente en Mi cuenta.
var ParaElCliente = map[Estado]string{
	"informado": "Por recibir", "cartera": "Aceptado", "entregado": "Endosado", "depositado": "Depositado",
	"acreditado": "Acreditado", "rechazado": "Rechazado", "anulado": "Anulado",
}

var noDigito = regexp.MustCompile(`\D`)

// NormalizarNumeroDeCheque deja solo los dígitos.
func NormalizarNumeroDeCheque(t string) string { return noDigito.ReplaceAllString(t, "") }

// RevisarNumeroDeCheque es revisarNumeroDeCheque: el problema, o "".
func RevisarNumeroDeCheque(t string) string {
	n := NormalizarNumeroDeCheque(t)
	switch {
	case len(n) == 0:
		return "Poné el número del cheque: es como se lo encuentra en el banco."
	case len(n) < 4:
		return "El número del cheque es muy corto. Revisalo contra el papel."
	case len(n) > 20:
		return "El número del cheque es muy largo. Revisalo contra el papel."
	}
	return ""
}

// NombreDelCheque: «Cheque Nación N° 00123456», «e-Cheq Galicia N° 1».
func NombreDelCheque(tipo string, banco *string, numero string) string {
	clase := "Cheque"
	if tipo == "echeq" {
		clase = "e-Cheq"
	}
	b := ""
	if banco != nil && *banco != "" {
		b = " " + *banco
	}
	return clase + b + " N° " + numero
}
