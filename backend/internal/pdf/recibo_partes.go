package pdf

import (
	"math"
	"strconv"
	"strings"
	"time"

	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
)

// Helpers que recibo.ts y resumen-cuenta.ts importan de otros módulos,
// copiados acá hasta que se muden sus tandas: NOMBRE_DEL_MEDIO e
// importeEnLetras son de lib/cobros/partes.ts (commit 9a17128), y Pesos es
// la función pesos() que repiten los dos documentos.

// nombreDelMedio es NOMBRE_DEL_MEDIO de lib/cobros/partes.ts.
var nombreDelMedio = map[string]string{
	"efectivo":        "Efectivo",
	"transferencia":   "Transferencia",
	"deposito":        "Depósito bancario",
	"cheque":          "Cheque",
	"echeq":           "e-Cheq",
	"tarjeta_debito":  "Tarjeta de débito",
	"tarjeta_credito": "Tarjeta de crédito",
	"mercado_pago":    "Mercado Pago",
	"retencion":       "Retención",
}

// Pesos es valor.toLocaleString("es-AR", {style: "currency", currency:
// "ARS", minimumFractionDigits: 2}): «$ 1.234,56», «-$ 0,00».
//
// Ojo: Intl (ICU) no redondea el valor exacto del double, como toFixed, sino
// su representación decimal más corta: 21021.995 es 21021.99499… en binario
// y toFixed da «21021.99», pero Intl lee «21021.995» y da «21.022,00». Se
// redondea la mitad hacia afuera sobre esa tira.
func Pesos(v float64) string {
	if math.IsNaN(v) {
		return "$ NaN"
	}
	signo := ""
	if math.Signbit(v) {
		signo = "-"
	}
	a := math.Abs(v)
	if math.IsInf(a, 0) {
		return signo + "$ ∞"
	}
	entero, dec := pesosRedondear2(strconv.FormatFloat(a, 'f', -1, 64))
	return signo + "$ " + formato.Miles(entero) + "," + dec
}

// pesosRedondear2 redondea una tira decimal sin signo a dos decimales, la
// mitad hacia arriba, y la devuelve partida en entero y decimales.
func pesosRedondear2(s string) (string, string) {
	entero, dec, _ := strings.Cut(s, ".")
	dec += "000"
	digitos := []byte(entero + dec[:2])
	if dec[2] >= '5' {
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
	n := len(digitos)
	return string(digitos[:n-2]), string(digitos[n-2:])
}

// fechaLocalUTC es toLocaleDateString("es-AR", {timeZone: "UTC"}).
func fechaLocalUTC(t time.Time) string {
	t = t.UTC()
	return strconv.Itoa(t.Day()) + "/" + strconv.Itoa(int(t.Month())) + "/" + strconv.Itoa(t.Year())
}

var (
	letrasUnidades = []string{
		"", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
		"diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
		"dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
		"veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
	}
	letrasDecenas  = []string{"", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"}
	letrasCentenas = []string{
		"", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
		"seiscientos", "setecientos", "ochocientos", "novecientos",
	}
)

// letrasHastaMil es hastaMil. Con n de mil o más (los millones de un importe
// de mil millones) CENTENAS[c] es undefined en el TS y queda vacío: se
// reproduce.
func letrasHastaMil(n float64) string {
	if n == 0 {
		return ""
	}
	if n == 100 {
		return "cien"
	}
	c := math.Floor(n / 100)
	resto := math.Mod(n, 100)
	texto := ""
	if c < float64(len(letrasCentenas)) {
		texto = letrasCentenas[int(c)]
	}
	if resto > 0 {
		var decenas string
		if resto < 30 {
			decenas = letrasUnidades[int(resto)]
		} else {
			decenas = letrasDecenas[int(math.Floor(resto/10))]
			if u := math.Mod(resto, 10); u != 0 {
				decenas += " y " + letrasUnidades[int(u)]
			}
		}
		if texto != "" {
			texto = texto + " " + decenas
		} else {
			texto = decenas
		}
	}
	return texto
}

func letrasApocopar(t string) string {
	if strings.HasSuffix(t, "veintiuno") {
		return strings.TrimSuffix(t, "veintiuno") + "veintiún"
	}
	if strings.HasSuffix(t, "uno") {
		return strings.TrimSuffix(t, "uno") + "un"
	}
	return t
}

// ImporteEnLetras es importeEnLetras de lib/cobros/partes.ts: «ciento
// veinte mil con 50/100».
func ImporteEnLetras(importe float64) string {
	a := math.Abs(importe)
	entero := math.Floor(a + 1e-9)
	centavos := jsmath.Round(float64((a - entero) * 100))

	millones := math.Floor(entero / 1_000_000)
	miles := math.Floor(math.Mod(entero, 1_000_000) / 1000)
	resto := math.Mod(entero, 1000)

	var partes []string
	if millones > 0 {
		if millones == 1 {
			partes = append(partes, "un millón")
		} else {
			partes = append(partes, letrasApocopar(letrasHastaMil(millones))+" millones")
		}
	}
	if miles > 0 {
		if miles == 1 {
			partes = append(partes, "mil")
		} else {
			partes = append(partes, letrasApocopar(letrasHastaMil(miles))+" mil")
		}
	}
	if resto > 0 {
		partes = append(partes, letrasHastaMil(resto))
	}
	letras := "cero"
	if len(partes) > 0 {
		letras = strings.Join(partes, " ")
	}
	c := numeroJS(centavos)
	for largoJS(c) < 2 {
		c = "0" + c
	}
	return letras + " con " + c + "/100"
}
