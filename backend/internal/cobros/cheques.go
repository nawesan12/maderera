package cobros

import (
	"regexp"
	"slices"
	"time"
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

// Los días que se aceptan para la fecha de pago de un cheque recibido,
// contados desde hoy en hora argentina (T3, hallazgo 41). Un cheque vencido
// hace más de un mes ya no se deposita, y uno a más de un año es un error de
// tipeo (2062 por 2026): los dos entraban a la cartera y ordenaban mal la
// semana.
const (
	ChequeDiasAtras    = 30
	ChequeDiasAdelante = 360
)

// LeerFechaDeCheque lee «AAAA-MM-DD» al mediodía argentino y rechaza las
// fechas que no existen (2026-02-31): la expresión regular las dejaba pasar
// y la base las rechazaba con un error de Postgres.
func LeerFechaDeCheque(texto string) (time.Time, bool) {
	if len(texto) != 10 {
		return time.Time{}, false
	}
	f, err := time.ParseInLocation("2006-01-02T15:04:05", texto+"T12:00:00", argentina)
	return f, err == nil
}

// RevisarFechaDeCheque: entre hoy − 30 y hoy + 360 días. Es la única regla
// para el recibo, la venta del mostrador y la carga a mano.
func RevisarFechaDeCheque(fecha, ahora time.Time) string {
	a := ahora.In(argentina)
	hoy := time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, argentina)
	desde, hasta := hoy.AddDate(0, 0, -ChequeDiasAtras), hoy.AddDate(0, 0, ChequeDiasAdelante+1)
	if f := fecha.In(argentina); f.Before(desde) || !f.Before(hasta) {
		return "La fecha de pago del cheque tiene que estar entre el " + fechaCorta(desde) + " y el " +
			fechaCorta(hasta.AddDate(0, 0, -1)) + "."
	}
	return ""
}

// RevisarFechasDeCheques mira la fecha de cada cheque nuevo del cobro.
func RevisarFechasDeCheques(partes []Parte, ahora time.Time) string {
	for _, p := range partes {
		if p.Cheque != nil {
			if m := RevisarFechaDeCheque(p.Cheque.FechaPago, ahora); m != "" {
				return m
			}
		}
	}
	return ""
}
