package fiscal

import (
	"strconv"
	"strings"

	cuits "mjbj/internal/cuit"
)

// El padrón de ARBA para la percepción de Ingresos Brutos (revisión del
// comité, T6). Antes se percibía con una sola alícuota a todos, también al
// consumidor final. ARBA publica cada mes un padrón con la alícuota de cada
// CUIT, y la percepción sale de ahí.

// FilaPadron es la alícuota de un CUIT y su vigencia (días argentinos,
// "2006-01-02", los dos inclusive).
type FilaPadron struct {
	Alicuota float64 `json:"alicuota"`
	Desde    string  `json:"desde"`
	Hasta    string  `json:"hasta"`
}

// PercepcionIibb dice con qué alícuota se le percibe a un receptor el día
// `dia` ("2006-01-02", argentino):
//
//   - al consumidor final y al exento, no;
//   - sin CUIT, no (no hay a quién buscar en el padrón);
//   - con una fila vigente del padrón, su alícuota (0 es «no se percibe»);
//   - si no figura o su fila no está vigente, la alícuota que el contador
//     fijó para quien no figura (sinPadron); sin ella, no se percibe.
func PercepcionIibb(condicion, documento string, fila *FilaPadron, dia string, sinPadron *float64) (float64, bool) {
	if condicion == ConsumidorFinal || condicion == "exento" {
		return 0, false
	}
	if len(SoloDigitos(documento)) != 11 {
		return 0, false
	}
	if fila != nil && fila.Desde <= dia && dia <= fila.Hasta {
		return fila.Alicuota, fila.Alicuota > 0
	}
	if sinPadron != nil && *sinPadron > 0 {
		return *sinPadron, true
	}
	return 0, false
}

// LineaDelPadron es un renglón leído del archivo de ARBA.
type LineaDelPadron struct {
	Cuit string
	FilaPadron
}

// LeerLineaDelPadron lee un renglón del padrón de regímenes generales de
// ARBA, separado por punto y coma:
//
//	P;25102026;01112026;30112026;30712345679;C;N;N;1,50;00;
//
// régimen (P percepción, R retención), fecha de publicación, vigencia desde
// y hasta (DDMMAAAA), CUIT, tipo, marcas de alta y de cambio de alícuota,
// alícuota con coma decimal y grupo. Solo interesan las de percepción; un
// renglón que no se entiende se descarta (ok falso).
func LeerLineaDelPadron(linea string) (LineaDelPadron, bool) {
	campos := strings.Split(strings.TrimSpace(linea), ";")
	if len(campos) < 9 || strings.TrimSpace(campos[0]) != "P" {
		return LineaDelPadron{}, false
	}
	desde, ok1 := diaDelPadron(campos[2])
	hasta, ok2 := diaDelPadron(campos[3])
	numero := SoloDigitos(campos[4])
	alicuota, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(campos[8]), ",", "."), 64)
	if !ok1 || !ok2 || hasta < desde || !cuits.Valido(numero) || err != nil || alicuota < 0 || alicuota > 100 {
		return LineaDelPadron{}, false
	}
	return LineaDelPadron{Cuit: numero, FilaPadron: FilaPadron{Alicuota: alicuota, Desde: desde, Hasta: hasta}}, true
}

// diaDelPadron pasa DDMMAAAA a "AAAA-MM-DD".
func diaDelPadron(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if len(s) != 8 || SoloDigitos(s) != s {
		return "", false
	}
	d, m := s[0:2], s[2:4]
	if m < "01" || m > "12" || d < "01" || d > "31" {
		return "", false
	}
	return s[4:8] + "-" + m + "-" + d, true
}
