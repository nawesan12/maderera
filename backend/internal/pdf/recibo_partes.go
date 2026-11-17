package pdf

import (
	"math"
	"strconv"
	"strings"
	"time"
)

// Helpers que recibo.ts y resumen-cuenta.ts importan de otros módulos,
// copiados acá hasta que se muden sus tandas: NOMBRE_DEL_MEDIO e
// importeEnLetras son de lib/cobros/partes.ts (commit 9a17128). La pesos()
// que repetían los dos documentos es Moneda2, en formato.go.

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

// letrasHastaMil es hastaMil: de 1 a 999.
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
//
// Dos cosas cambiaron desde el TS, a propósito. Los centavos salen del mismo
// redondeo que los números del recibo (Moneda2): antes 999,995 se imprimía
// «$ 1.000,00» y en letras «novecientos noventa y nueve con 100/100», y
// 2,675 era «$ 2,68» y «con 67/100». Y desde mil millones el TS perdía los
// millones (1.234.567.890 decía «treinta y cuatro millones…»): ahora los
// millones se escriben con sus miles, y arriba están los billones.
func ImporteEnLetras(importe float64) string {
	enteroTexto, c := redondear2(math.Abs(importe))
	entero, _ := strconv.ParseFloat(enteroTexto, 64)

	billones := math.Floor(entero / 1e12)
	millones := math.Floor(math.Mod(entero, 1e12) / 1e6)
	resto := math.Mod(entero, 1e6)

	var partes []string
	switch {
	case billones == 1:
		partes = append(partes, "un billón")
	case billones > 0:
		partes = append(partes, letrasApocopar(letrasHastaMillon(billones))+" billones")
	}
	switch {
	case millones == 1:
		partes = append(partes, "un millón")
	case millones > 0:
		partes = append(partes, letrasApocopar(letrasHastaMillon(millones))+" millones")
	}
	if resto > 0 {
		partes = append(partes, letrasHastaMillon(resto))
	}
	letras := "cero"
	if len(partes) > 0 {
		letras = strings.Join(partes, " ")
	}
	return letras + " con " + c + "/100"
}

// letrasHastaMillon escribe un número de 1 a 999.999: «veintiún mil
// doscientos». Con el uno final entero («veintiuno»): quien lo usa para los
// millones lo apocopa.
func letrasHastaMillon(n float64) string {
	miles := math.Floor(n / 1000)
	resto := math.Mod(n, 1000)
	var partes []string
	switch {
	case miles == 1:
		partes = append(partes, "mil")
	case miles > 0:
		partes = append(partes, letrasApocopar(letrasHastaMil(miles))+" mil")
	}
	if resto > 0 {
		partes = append(partes, letrasHastaMil(resto))
	}
	return strings.Join(partes, " ")
}
