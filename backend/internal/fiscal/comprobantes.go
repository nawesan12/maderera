package fiscal

import (
	"regexp"
	"strconv"
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// Las condiciones frente al IVA y los tipos de comprobante, con los nombres
// de los enum de la base.
const (
	ResponsableInscripto = "responsable_inscripto"
	Monotributista       = "monotributista"
	Exento               = "exento"
	ConsumidorFinal      = "consumidor_final"
	NoCategorizado       = "no_categorizado"
)

// NombreCondicion es cómo se escribe la condición en papel (el comprobante y
// el libro IVA).
var NombreCondicion = map[string]string{
	ResponsableInscripto: "Responsable inscripto",
	Monotributista:       "Responsable monotributo",
	Exento:               "IVA exento",
	ConsumidorFinal:      "Consumidor final",
	NoCategorizado:       "No categorizado",
}

// Condiciones, en el orden del enum de zod.
var Condiciones = []string{ResponsableInscripto, Monotributista, Exento, ConsumidorFinal, NoCategorizado}

// LetraQueCorresponde: un responsable inscripto emite A a otro inscripto y B
// a los demás; un monotributista o un exento, siempre C.
func LetraQueCorresponde(emisor, receptor string) string {
	if emisor == ResponsableInscripto {
		if receptor == ResponsableInscripto {
			return "A"
		}
		return "B"
	}
	return "C"
}

// TipoFactura es `factura_<letra>`.
func TipoFactura(letra string) string { return "factura_" + strings.ToLower(letra) }

// NotaDeCredito lleva la letra del comprobante que corrige, sea una factura
// o una nota. El TS solo cambiaba el prefijo «factura»: sobre una nota de
// débito devolvía el mismo tipo, y la nota de crédito salía como débito (y
// al revés).
func NotaDeCredito(tipo string) string { return "nota_credito_" + strings.ToLower(LetraDe(tipo)) }

// NotaDeDebito, igual.
func NotaDeDebito(tipo string) string { return "nota_debito_" + strings.ToLower(LetraDe(tipo)) }

// Reverso es el comprobante que deshace a otro: una nota de crédito para una
// factura o una nota de débito, y una nota de débito para una nota de
// crédito. Siempre de la misma letra.
func Reverso(tipo string) string {
	if EsNotaDeCredito(tipo) {
		return NotaDeDebito(tipo)
	}
	return NotaDeCredito(tipo)
}

// LetraDe es la última letra, en mayúscula.
func LetraDe(tipo string) string {
	if tipo == "" {
		return ""
	}
	return strings.ToUpper(tipo[len(tipo)-1:])
}

// EsNotaDeCredito y EsRectificativo (crédito o débito: las dos declaran el
// comprobante asociado).
func EsNotaDeCredito(tipo string) bool { return strings.HasPrefix(tipo, "nota_credito") }

// EsRectificativo cubre las dos notas.
func EsRectificativo(tipo string) bool {
	return strings.HasPrefix(tipo, "nota_credito") || strings.HasPrefix(tipo, "nota_debito")
}

// DiscriminaIva: solo la A.
func DiscriminaIva(tipo string) bool { return LetraDe(tipo) == "A" }

// CodigoComprobante es el CbteTipo de WSFEv1.
var CodigoComprobante = map[string]int{
	"factura_a": 1, "nota_debito_a": 2, "nota_credito_a": 3,
	"factura_b": 6, "nota_debito_b": 7, "nota_credito_b": 8,
	"factura_c": 11, "nota_debito_c": 12, "nota_credito_c": 13,
}

// Los DocTipo del receptor.
const (
	DocCuit            = 80
	DocDni             = 96
	DocConsumidorFinal = 99
)

// CondicionIvaReceptor es CondicionIVAReceptorId (obligatorio desde 2026).
var CondicionIvaReceptor = map[string]int{
	ResponsableInscripto: 1, Exento: 4, ConsumidorFinal: 5, Monotributista: 6, NoCategorizado: 7,
}

var noDigito = regexp.MustCompile(`\D`)

// SoloDigitos es replace(/\D/g, "").
func SoloDigitos(s string) string { return noDigito.ReplaceAllString(s, "") }

// DocumentoReceptor: once dígitos es CUIT; siete u ocho, DNI; si no,
// consumidor final con número 0.
func DocumentoReceptor(cuit *string) (tipo int, numero float64) {
	limpio := ""
	if cuit != nil {
		limpio = SoloDigitos(*cuit)
	}
	switch len(limpio) {
	case 11:
		return DocCuit, jsmath.Numero(limpio)
	case 7, 8:
		return DocDni, jsmath.Numero(limpio)
	}
	return DocConsumidorFinal, 0
}

// NombreComprobante: «Factura A», «Nota de crédito B».
func NombreComprobante(tipo string) string {
	l := LetraDe(tipo)
	switch {
	case strings.HasPrefix(tipo, "nota_credito"):
		return "Nota de crédito " + l
	case strings.HasPrefix(tipo, "nota_debito"):
		return "Nota de débito " + l
	}
	return "Factura " + l
}

func rellenar(n int64, largo int) string {
	s := strconv.FormatInt(n, 10)
	for len(s) < largo {
		s = "0" + s
	}
	return s
}

// NumeroFormateado: «0003-00000127».
func NumeroFormateado(puntoVenta, numero int64) string {
	return rellenar(puntoVenta, 4) + "-" + rellenar(numero, 8)
}

// Argentina es la zona de ARCA. Las fechas que van a ARCA (CbteFch, el QR,
// la del comprobante asociado) son el día en Argentina.
var Argentina = func() *time.Location {
	if l, err := time.LoadLocation("America/Argentina/Buenos_Aires"); err == nil {
		return l
	}
	return time.FixedZone("ART", -3*60*60)
}()

// FechaArca es AAAAMMDD en hora argentina.
//
// El TS usaba la zona del proceso (getFullYear/getMonth/getDate) y Next corre
// en UTC: desde las 21 h el comprobante iba a ARCA con la fecha de mañana.
func FechaArca(t time.Time) string { return t.In(Argentina).Format("20060102") }

var ochoDigitos = regexp.MustCompile(`^\d{8}$`)

// DesdeFechaArca pasa AAAAMMDD a la medianoche argentina de ese día (el TS la
// ponía a la medianoche del proceso, UTC: el vencimiento del CAE se mostraba
// un día antes). nil si no es una fecha.
func DesdeFechaArca(texto string) *time.Time {
	if !ochoDigitos.MatchString(texto) {
		return nil
	}
	a, _ := strconv.Atoi(texto[:4])
	m, _ := strconv.Atoi(texto[4:6])
	d, _ := strconv.Atoi(texto[6:8])
	t := time.Date(a, time.Month(m), d, 0, 0, 0, 0, Argentina)
	return &t
}
