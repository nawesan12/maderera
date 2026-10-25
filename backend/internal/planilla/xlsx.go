package planilla

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// El lector de .xlsx (lib/xlsx.ts): la primera hoja como grilla de textos,
// con las fechas convertidas, los huecos rellenados por la referencia de cada
// celda y los textos compartidos resueltos. Las fórmulas se leen por su
// último valor calculado.
//
// Lo que sigue recorre el objeto de fast-xml-parser (xml.go) con la misma
// semántica que el TS: `a?.b` sobre un string o un arreglo es undefined,
// String() de un arreglo une con comas, Number() de lo que no es número es
// NaN.

// prop es `v?.[k]` sobre lo que devuelve el parser.
func prop(v valor, k string) valor {
	if o, ok := v.(*objeto); ok {
		v, _ := o.get(k)
		return v
	}
	return nil
}

// lista es comoLista: siempre un arreglo.
func lista(v valor) []valor {
	switch x := v.(type) {
	case nil:
		return nil
	case []valor:
		return x
	}
	return []valor{v}
}

// textoDe es String(v).
func textoDe(v valor) string {
	switch x := v.(type) {
	case nil:
		return "undefined"
	case string:
		return x
	case []valor:
		partes := make([]string, len(x))
		for i, e := range x {
			partes[i] = textoDe(e)
		}
		return strings.Join(partes, ",")
	}
	return "[object Object]"
}

// numeroDe es Number(v).
func numeroDe(v valor) float64 {
	switch v.(type) {
	case nil, *objeto:
		return math.NaN()
	}
	return numeroJS(textoDe(v))
}

func leerXML(archivos map[string][]byte, ruta string) (valor, error) {
	b, ok := archivos[ruta]
	if !ok {
		return nil, nil
	}
	o, err := parsearXML(decodificarUTF8(b))
	if err != nil {
		return nil, err
	}
	return o, nil
}

// Los formatos numéricos de fábrica de Excel que son fechas u horas.
var formatosFecha = map[float64]bool{14: true, 15: true, 16: true, 17: true, 18: true, 19: true, 20: true, 21: true, 22: true, 45: true, 46: true, 47: true}

var (
	entreComillas = regexp.MustCompile(`"[^"]*"`)
	conFechaUHora = regexp.MustCompile(`[dmyhsDMYHS]`) // sin (?i): Go pliega la s con la ſ y JS no
	conDiaOAnio   = regexp.MustCompile(`[dyDY]`)
	rutaDeHoja    = regexp.MustCompile(`^xl/worksheets/sheet[0-9]+\.xml$`)
)

// conjunto es un Set de números de JS: NaN no se encuentra nunca (en un Set
// de JS sí, pero acá solo se buscan índices) y -0 es 0, como en un map de Go.
type conjunto map[float64]bool

func (c conjunto) tiene(x float64) bool { return !math.IsNaN(x) && c[x] }

// estilosDeFecha dice qué índices de estilo (cellXfs) tienen formato de fecha.
func estilosDeFecha(archivos map[string][]byte) (conjunto, error) {
	estilos := conjunto{}
	raiz, err := leerXML(archivos, "xl/styles.xml")
	if err != nil {
		return nil, err
	}
	hoja := prop(raiz, "styleSheet")
	if hoja == nil || hoja == "" {
		return estilos, nil
	}

	// Formatos personalizados: si el patrón (sin lo que va entre comillas)
	// tiene día, mes o año, es una fecha.
	personalizados := map[float64]bool{}
	nanPersonalizado := false
	for _, fmtv := range lista(prop(prop(hoja, "numFmts"), "numFmt")) {
		cv := prop(fmtv, "@formatCode")
		if cv == nil {
			cv = ""
		}
		codigo, ok := cv.(string)
		if !ok {
			return nil, &errorJS{"fmt[\"@formatCode\"].replace is not a function"}
		}
		codigo = entreComillas.ReplaceAllString(codigo, "")
		if conFechaUHora.MatchString(codigo) && conDiaOAnio.MatchString(codigo) {
			id := numeroDe(prop(fmtv, "@numFmtId"))
			if math.IsNaN(id) {
				nanPersonalizado = true
			} else {
				personalizados[id] = true
			}
		}
	}

	for indice, xf := range lista(prop(prop(hoja, "cellXfs"), "xf")) {
		var id float64
		if v := prop(xf, "@numFmtId"); v != nil {
			id = numeroDe(v)
		}
		if formatosFecha[id] || personalizados[id] || math.IsNaN(id) && nanPersonalizado {
			estilos[float64(indice)] = true
		}
	}
	return estilos, nil
}

// columnaDeReferencia: "BC12" -> 54 (base cero); lo que no empieza con una
// mayúscula da -1. En float64, como en JS.
func columnaDeReferencia(referencia string) float64 {
	columna := 0.0
	for _, r := range referencia {
		if r < 'A' || r > 'Z' {
			break
		}
		columna = float64(columna*26) + float64(r-64)
	}
	return columna - 1
}

// textoDeT lee un <t>: el texto, o el "#text" si trae atributos.
func textoDeT(t valor) string {
	if s, ok := t.(string); ok {
		return s
	}
	v := prop(t, "#text")
	if v == nil {
		return ""
	}
	return textoDe(v)
}

func textosCompartidos(archivos map[string][]byte) ([]string, error) {
	raiz, err := leerXML(archivos, "xl/sharedStrings.xml")
	if err != nil {
		return nil, err
	}
	var salida []string
	for _, si := range lista(prop(prop(raiz, "sst"), "si")) {
		t := prop(si, "t")
		switch t.(type) {
		case string:
			salida = append(salida, t.(string))
			continue
		case *objeto, []valor:
			salida = append(salida, textoDeT(t))
			continue
		}
		// Texto con formato: <si><r><t>ho</t></r><r><t>la</t></r></si>
		var sb strings.Builder
		for _, r := range lista(prop(si, "r")) {
			sb.WriteString(textoDeT(prop(r, "t")))
		}
		salida = append(salida, sb.String())
	}
	return salida, nil
}

// fechaDeSerie convierte un número de serie de Excel a fecha ISO, con el 29
// de febrero de 1900 que Excel cree que existió.
func fechaDeSerie(serie float64) (string, error) {
	dias := math.Floor(serie)
	ajuste := 0.0
	if dias > 59 {
		ajuste = -1
	}
	ms := float64(dias+ajuste-25569) * 86400000
	fraccion := serie - dias
	t := ms + jsmath.Round(float64(fraccion*86400000))
	// TimeClip: fuera de ±8.64e15 ms la fecha es inválida y toISOString tira.
	if math.IsNaN(t) || math.Abs(t) > 8.64e15 {
		return "", &errorJS{"Invalid time value"}
	}
	f := time.UnixMilli(int64(t)).UTC()
	anio := f.Year()
	var a string
	switch {
	case anio >= 0 && anio <= 9999:
		a = fmt.Sprintf("%04d", anio)
	case anio < 0:
		a = fmt.Sprintf("-%06d", -anio)
	default:
		a = fmt.Sprintf("+%06d", anio)
	}
	return a + f.Format("-01-02T15:04:05.000Z"), nil
}

func valorDeCelda(celda valor, compartidos []string, fechas conjunto) (string, error) {
	tipo := "n"
	if v := prop(celda, "@t"); v != nil {
		tipo = textoDe(v)
	}

	// Texto escrito dentro de la celda.
	if tipo == "inlineStr" {
		return textoDeT(prop(prop(celda, "is"), "t")), nil
	}

	var texto string
	switch b := prop(celda, "v").(type) {
	case string:
		texto = b
	case *objeto, []valor:
		texto = textoDeT(b)
	}
	if texto == "" {
		return "", nil
	}

	switch tipo {
	case "s":
		n := numeroJS(texto)
		if n >= 0 && n < float64(len(compartidos)) && n == math.Trunc(n) {
			return compartidos[int(n)], nil
		}
		return "", nil
	case "b":
		if texto == "1" {
			return "VERDADERO", nil
		}
		return "FALSO", nil
	case "e":
		return texto, nil
	}

	estilo := -1.0
	if v := prop(celda, "@s"); v != nil {
		estilo = numeroDe(v)
	}
	if fechas.tiene(estilo) {
		// Solo se convierte lo que de verdad es un número de serie.
		if serie := numeroJS(texto); esFinito(serie) && serie > 0 {
			return fechaDeSerie(serie)
		}
	}
	return texto, nil
}

// maxColumnas corta una referencia absurda ("ZZZZZZZZ1") antes de llenar la
// memoria de celdas vacías. En el TS el arreglo crece hasta que Node se queda
// sin memoria; Excel no pasa de XFD (16384 columnas).
const maxColumnas = 1 << 22

// LeerXlsx lee la primera hoja de un .xlsx y devuelve la grilla como texto y
// el nombre de la hoja.
func LeerXlsx(datos []byte) (filas [][]string, hoja string, err error) {
	archivos, err := abrirZip(datos)
	if err != nil {
		return nil, "", err
	}

	libro, err := leerXML(archivos, "xl/workbook.xml")
	if err != nil {
		return nil, "", err
	}
	hoja = "Hoja 1"
	if hojas := lista(prop(prop(prop(libro, "workbook"), "sheets"), "sheet")); len(hojas) > 0 {
		if n := prop(hojas[0], "@name"); n != nil {
			hoja = textoDe(n)
		}
	}

	// La ruta de la hoja: la primera en orden alfabético ("sheet10" va antes
	// que "sheet2"), no la que nombra el libro.
	var rutas []string
	for nombre := range archivos {
		if rutaDeHoja.MatchString(nombre) {
			rutas = append(rutas, nombre)
		}
	}
	sort.Strings(rutas)
	ruta := "xl/worksheets/sheet1.xml"
	if len(rutas) > 0 {
		ruta = rutas[0]
	}

	datosHoja, err := leerXML(archivos, ruta)
	if err != nil {
		return nil, "", err
	}
	if datosHoja == nil {
		return nil, "", &errorJS{"El .xlsx no tiene ninguna hoja que se pueda leer."}
	}

	compartidos, err := textosCompartidos(archivos)
	if err != nil {
		return nil, "", err
	}
	fechas, err := estilosDeFecha(archivos)
	if err != nil {
		return nil, "", err
	}

	filas = [][]string{}
	for _, filaCruda := range lista(prop(prop(prop(datosHoja, "worksheet"), "sheetData"), "row")) {
		celdas := []string{}
		for _, celda := range lista(prop(filaCruda, "c")) {
			referencia := ""
			if v := prop(celda, "@r"); v != nil {
				referencia = textoDe(v)
			}
			indice := float64(len(celdas))
			if referencia != "" {
				indice = columnaDeReferencia(referencia)
			}
			if indice > maxColumnas {
				return nil, "", &errorJS{"Invalid array length"}
			}
			// Los huecos se rellenan: una fila que arranca en C entra con dos
			// campos vacíos adelante.
			for float64(len(celdas)) < indice {
				celdas = append(celdas, "")
			}
			texto, err := valorDeCelda(celda, compartidos, fechas)
			if err != nil {
				return nil, "", err
			}
			// Con una referencia que no empieza con mayúscula el índice es -1:
			// en JS eso es una propiedad del arreglo, no una celda, y se pierde.
			if indice < 0 {
				continue
			}
			k := int(indice)
			if k == len(celdas) {
				celdas = append(celdas, texto)
			} else {
				celdas[k] = texto
			}
		}
		filas = append(filas, celdas)
	}

	// Las filas en blanco del final del rango no son registros.
	for len(filas) > 0 && todasVacias(filas[len(filas)-1]) {
		filas = filas[:len(filas)-1]
	}
	return filas, hoja, nil
}

func todasVacias(fila []string) bool {
	for _, c := range fila {
		if c != "" {
			return false
		}
	}
	return true
}
