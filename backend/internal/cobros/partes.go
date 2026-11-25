// Package cobros es la plata que entra de un cliente: las partes de un cobro
// (efectivo, cheque, transferencia…), el recibo —la única puerta—, los
// cheques de la cartera, la cuenta corriente con su aging y la prioridad de
// cobranza. Era lib/cobros, lib/cheques y lib/cuenta-corriente.
package cobros

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// Medio es con qué se paga una parte.
type Medio string

// Los medios de cobro, en el orden del TS.
var Medios = []Medio{"efectivo", "transferencia", "deposito", "cheque", "echeq", "tarjeta_debito", "tarjeta_credito", "mercado_pago", "retencion"}

// NombreDelMedio es cómo se dice en el recibo.
var NombreDelMedio = map[Medio]string{
	"efectivo": "Efectivo", "transferencia": "Transferencia", "deposito": "Depósito bancario", "cheque": "Cheque",
	"echeq": "e-Cheq", "tarjeta_debito": "Tarjeta de débito", "tarjeta_credito": "Tarjeta de crédito",
	"mercado_pago": "Mercado Pago", "retencion": "Retención",
}

// ChequeNuevo son los datos de un cheque que llega con el cobro.
type ChequeNuevo struct {
	Numero, Banco string
	Librador      *string
	FechaPago     time.Time
	Emision       *time.Time
}

// Parte es una parte del cobro.
type Parte struct {
	Medio      Medio
	Importe    float64
	Referencia *string
	ChequeID   *string
	Cheque     *ChequeNuevo
	PaymentID  *string
}

// EsCheque: cheque o e-Cheq.
func EsCheque(m Medio) bool { return m == "cheque" || m == "echeq" }

// ACentavos es aCentavos: Math.round(n*100)/100.
func ACentavos(n float64) float64 { return jsmath.Round(n*100) / 100 }

// TotalDePartes suma los importes a centavos, como el TS.
func TotalDePartes(importes []float64) float64 {
	s := 0.0
	for _, i := range importes {
		s += ACentavos(i)
	}
	return ACentavos(s)
}

func importes(partes []Parte) []float64 {
	out := make([]float64, len(partes))
	for i, p := range partes {
		out[i] = p.Importe
	}
	return out
}

// Revisar es revisarPartes: el primer problema, o "".
func Revisar(partes []Parte, circuito string) string {
	if circuito == "" {
		circuito = "blanco"
	}
	if len(partes) == 0 {
		return "Cargá con qué paga."
	}
	for i, p := range partes {
		cual := ""
		if len(partes) > 1 {
			cual = " (renglón " + strconv.Itoa(i+1) + ")"
		}
		if math.IsNaN(p.Importe) || math.IsInf(p.Importe, 0) || p.Importe <= 0 {
			return "El importe tiene que ser mayor a cero" + cual + "."
		}
		if EsCheque(p.Medio) {
			if p.ChequeID == nil && p.Cheque == nil {
				return "Faltan los datos del cheque" + cual + "."
			}
			if p.Cheque != nil {
				if problema := RevisarNumeroDeCheque(p.Cheque.Numero); problema != "" {
					return problema + cual
				}
				if strings.TrimSpace(p.Cheque.Banco) == "" {
					return "Poné el banco del cheque" + cual + "."
				}
				if p.Cheque.FechaPago.IsZero() {
					return "Poné la fecha de pago del cheque" + cual + "."
				}
			}
			if p.Medio == "echeq" && circuito == "negro" {
				return "Un e-Cheq no puede ir por el circuito B: queda registrado en el banco a nombre de la empresa."
			}
		} else if p.Cheque != nil || p.ChequeID != nil {
			return "Hay datos de cheque en un pago que no es con cheque" + cual + "."
		}
	}
	vistos := map[string]bool{}
	for _, p := range partes {
		if p.ChequeID != nil && *p.ChequeID != "" {
			if vistos[*p.ChequeID] {
				return "El mismo cheque está cargado dos veces."
			}
			vistos[*p.ChequeID] = true
		}
	}
	return ""
}

var (
	unidades = []string{"", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
		"diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
		"dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
		"veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"}
	decenas  = []string{"", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"}
	centenas = []string{"", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
		"seiscientos", "setecientos", "ochocientos", "novecientos"}
)

func hastaMil(n int) string {
	if n == 0 {
		return ""
	}
	if n == 100 {
		return "cien"
	}
	c, resto := n/100, n%100
	texto := ""
	if c < len(centenas) {
		texto = centenas[c]
	}
	if resto > 0 {
		var d string
		if resto < 30 {
			d = unidades[resto]
		} else {
			d = decenas[resto/10]
			if resto%10 != 0 {
				d += " y " + unidades[resto%10]
			}
		}
		if texto != "" {
			texto += " " + d
		} else {
			texto = d
		}
	}
	return texto
}

func apocopar(t string) string {
	if strings.HasSuffix(t, "veintiuno") {
		return strings.TrimSuffix(t, "veintiuno") + "veintiún"
	}
	if strings.HasSuffix(t, "uno") {
		return strings.TrimSuffix(t, "uno") + "un"
	}
	return t
}

func hastaUnMillon(n int) string {
	miles, resto := n/1000, n%1000
	var trozos []string
	if miles > 0 {
		if miles == 1 {
			trozos = append(trozos, "mil")
		} else {
			trozos = append(trozos, apocopar(hastaMil(miles))+" mil")
		}
	}
	if resto > 0 {
		trozos = append(trozos, hastaMil(resto))
	}
	return strings.Join(trozos, " ")
}

// ImporteEnLetras es importeEnLetras: «ochenta y cuatro mil quinientos con 50/100».
func ImporteEnLetras(importe float64) string {
	a := math.Abs(importe)
	entero := math.Floor(a + 1e-9)
	cent := int(jsmath.Round(float64(a-entero) * 100))
	e := int(entero)
	millones, resto := e/1_000_000, e%1_000_000
	var partes []string
	if millones > 0 {
		if millones == 1 {
			partes = append(partes, "un millón")
		} else {
			partes = append(partes, apocopar(hastaUnMillon(millones))+" millones")
		}
	}
	if resto > 0 {
		partes = append(partes, hastaUnMillon(resto))
	}
	letras := "cero"
	if len(partes) > 0 {
		letras = strings.Join(partes, " ")
	}
	return letras + " con " + fmt.Sprintf("%02d", cent) + "/100"
}
