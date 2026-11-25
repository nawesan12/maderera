// Package planilla lee las planillas que sube el cliente —CSV o .xlsx— y las
// deja como una grilla de textos. Es la mudanza de lib/csv.ts, lib/xlsx.ts,
// lib/planilla.ts y lib/precios-csv.ts, y tiene que dar exactamente lo mismo
// que el TypeScript: los golden de testdata/golden/planilla los genera el TS
// real (scripts/golden/planilla.ts).
//
// Tres particularidades hacen que un CSV "no funcione" en la vida real, y las
// tres se resuelven acá: el separador `;` de Excel en español (se deduce del
// encabezado), la codificación Windows-1252 de los sistemas viejos (se prueba
// UTF-8 estricto y se cae a Windows-1252) y los saltos de línea dentro de
// comillas (se recorre carácter por carácter, no por renglón).
package planilla

import (
	"bytes"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

const bom = string(rune(0xfeff))

var separadores = []string{";", "\t", ","}

// FormatoBinario reconoce por los primeros bytes los archivos que no son
// texto: "xlsx" (un ZIP), "xls" (documento compuesto de Office), "pdf", o ""
// si parece texto.
func FormatoBinario(datos []byte) string {
	if len(datos) >= 2 && datos[0] == 0x50 && datos[1] == 0x4b {
		return "xlsx"
	}
	if bytes.HasPrefix(datos, []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}) {
		return "xls"
	}
	if bytes.HasPrefix(datos, []byte("%PDF")) {
		return "pdf"
	}
	return ""
}

// DecodificarPlanilla convierte los bytes a texto: UTF-8 estricto primero y,
// si no es UTF-8 válido, Windows-1252. Devuelve el texto sin el BOM y la
// codificación que se usó ("utf-8" o "windows-1252").
func DecodificarPlanilla(datos []byte) (texto, codificacion string) {
	// utf8.Valid rechaza lo mismo que TextDecoder con fatal: true (sustitutos,
	// formas largas, más allá de U+10FFFF, secuencias cortadas).
	if utf8.Valid(datos) {
		// TextDecoder ya saca un BOM; el replace del TS, otro.
		t := strings.TrimPrefix(string(datos), bom)
		return strings.TrimPrefix(t, bom), "utf-8"
	}
	return strings.TrimPrefix(decodificarWindows1252(datos), bom), "windows-1252"
}

// DetectarSeparador deduce el separador contando cuál de ";", tabulador y ","
// aparece más en la primera línea. En el empate gana el primero, y sin
// ninguno, ";".
func DetectarSeparador(texto string) string {
	encabezado := strings.TrimPrefix(texto, bom)
	if i := strings.IndexByte(encabezado, '\n'); i >= 0 {
		encabezado = strings.TrimSuffix(encabezado[:i], "\r")
	}
	elegido, mayor := ";", 0
	for _, s := range separadores {
		if n := strings.Count(encabezado, s); n > mayor {
			mayor, elegido = n, s
		}
	}
	return elegido
}

// PartirPlanilla parte el archivo entero en filas y campos, con los campos
// recortados y sin las filas completamente vacías.
func PartirPlanilla(texto, separador string) [][]string {
	contenido := strings.TrimPrefix(texto, bom)
	contenido = strings.ReplaceAll(contenido, "\r\n", "\n")
	contenido = strings.ReplaceAll(contenido, "\r", "\n")

	// El separador del TS es un carácter: se compara con contenido[i].
	sep := rune(-1)
	if utf8.RuneCountInString(separador) == 1 {
		if r, _ := utf8.DecodeRuneInString(separador); r <= 0xffff {
			sep = r // uno fuera del plano básico son dos unidades en JS: nunca coincide
		}
	}

	filas := [][]string{}
	campos := []string{}
	var actual strings.Builder
	entreComillas := false

	cerrarCampo := func() {
		campos = append(campos, trimJS(actual.String()))
		actual.Reset()
	}
	cerrarFila := func() {
		cerrarCampo()
		for _, c := range campos {
			if c != "" {
				filas = append(filas, campos)
				break
			}
		}
		campos = []string{}
	}

	rs := []rune(contenido)
	for i := 0; i < len(rs); i++ {
		c := rs[i]
		if entreComillas {
			if c == '"' {
				// Dos comillas seguidas son una comilla del dato.
				if i+1 < len(rs) && rs[i+1] == '"' {
					actual.WriteByte('"')
					i++
				} else {
					entreComillas = false
				}
				continue
			}
			actual.WriteRune(c)
			continue
		}
		// La comilla solo delimita si abre el campo: en el medio es la pulgada
		// de 2" x 4".
		if c == '"' && trimJS(actual.String()) == "" {
			actual.Reset()
			entreComillas = true
			continue
		}
		if c == sep {
			cerrarCampo()
			continue
		}
		if c == '\n' {
			cerrarFila()
			continue
		}
		actual.WriteRune(c)
	}
	if actual.Len() > 0 || len(campos) > 0 {
		cerrarFila()
	}
	return filas
}

// PartirLinea parte una sola línea.
func PartirLinea(linea, separador string) []string {
	if filas := PartirPlanilla(linea, separador); len(filas) > 0 {
		return filas[0]
	}
	return []string{}
}

// NormalizarEncabezado deja un nombre de columna comparable: minúsculas, sin
// tildes y solo letras y dígitos ASCII. "Razón Social" y "razon_social" son
// la misma columna.
func NormalizarEncabezado(texto string) string {
	var sb strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(texto)) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			sb.WriteRune(r)
		}
	}
	return sb.String()
}

// InterpretarNumero convierte lo escrito en una celda a un número con dos
// decimales, respetando el signo. Acepta "12.345,67", "12345.67", "$ 12.345",
// "12345" y "(1.500,00)" (negativo de contabilidad). El segundo valor es
// false cuando no se puede interpretar.
func InterpretarNumero(bruto string) (string, bool) {
	texto := trimJS(bruto)
	if texto == "" {
		return "", false
	}

	// /^\(.*\)$/: el punto de JS no cruza saltos de línea.
	entreParentesis := len(texto) >= 2 && texto[0] == '(' && texto[len(texto)-1] == ')' &&
		!strings.ContainsAny(texto, "\n\r  ")

	var sb strings.Builder
	for i := 0; i < len(texto); i++ {
		if c := texto[i]; c >= '0' && c <= '9' || c == '.' || c == ',' || c == '-' {
			sb.WriteByte(c)
		}
	}
	limpio := sb.String()
	if limpio == "" || limpio == "-" {
		return "", false
	}

	negativo := entreParentesis || strings.HasPrefix(limpio, "-")
	cuerpo := limpio
	if negativo {
		cuerpo = strings.TrimPrefix(limpio, "-")
	}
	// Un guion en el medio no es un signo.
	if strings.Contains(cuerpo, "-") {
		return "", false
	}

	tieneComa := strings.Contains(cuerpo, ",")
	tienePunto := strings.Contains(cuerpo, ".")
	normalizado := cuerpo

	switch {
	case tieneComa && tienePunto:
		// El último separador que aparece es el decimal.
		if strings.LastIndex(cuerpo, ",") > strings.LastIndex(cuerpo, ".") {
			normalizado = strings.Replace(strings.ReplaceAll(cuerpo, ".", ""), ",", ".", 1)
		} else {
			normalizado = strings.ReplaceAll(cuerpo, ",", "")
		}
	case tieneComa:
		// "1,234": tres cifras detrás de la (primera) coma son miles, salvo
		// que adelante haya un cero o nada ("0,125" no son 125; el TS lo
		// leía así, arreglado en la tanda 13).
		partes := strings.Split(cuerpo, ",")
		enteros, decimales := partes[0], partes[1]
		if len(decimales) == 3 && enteros != "" && enteros != "0" {
			normalizado = strings.ReplaceAll(cuerpo, ",", "")
		} else {
			normalizado = strings.Replace(cuerpo, ",", ".", 1)
		}
	case tienePunto:
		// "96.500" son noventa y seis mil quinientos.
		decimales := cuerpo[strings.LastIndex(cuerpo, ".")+1:]
		enteros := cuerpo[:strings.Index(cuerpo, ".")]
		if len(decimales) == 3 && enteros != "" && enteros != "0" {
			normalizado = strings.ReplaceAll(cuerpo, ".", "")
		}
	}

	numero := numeroJS(normalizado)
	if !esFinito(numero) {
		return "", false
	}
	if negativo {
		numero = -numero
	}
	return toFixed2(numero), true
}
