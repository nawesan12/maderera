package planilla

import (
	"strings"

	"mjbj/internal/csvexcel"
	"mjbj/internal/jsmath"
)

// Columnas es el encabezado de la planilla de precios que se descarga.
var Columnas = [...]string{
	"SKU",
	"Producto",
	"Medida",
	"Categoria",
	"Precio lista",
	"Precio profesional",
}

// FilaPlanilla es una variante en la planilla que se descarga. Los precios
// van como texto con punto decimal ("84500.50").
type FilaPlanilla struct {
	Sku               string `json:"sku"`
	Producto          string `json:"producto"`
	Medida            string `json:"medida"`
	Categoria         string `json:"categoria"`
	PrecioGeneral     string `json:"precioGeneral"`
	PrecioProfesional string `json:"precioProfesional"`
}

func escapar(valor string) string {
	if strings.ContainsAny(valor, "\";\n") {
		return `"` + strings.ReplaceAll(valor, `"`, `""`) + `"`
	}
	return valor
}

// GenerarCsv arma la planilla para descargar: con BOM, `;` y CRLF, y los
// precios con coma decimal.
func GenerarCsv(filas []FilaPlanilla) string {
	var sb strings.Builder
	sb.WriteString(bom)
	sb.WriteString(strings.Join(Columnas[:], ";"))
	for _, f := range filas {
		campos := []string{
			f.Sku,
			f.Producto,
			f.Medida,
			f.Categoria,
			strings.Replace(f.PrecioGeneral, ".", ",", 1),
			strings.Replace(f.PrecioProfesional, ".", ",", 1),
		}
		for i, c := range campos {
			if i < 4 { // SKU, producto, medida y categoría: los textos
				c = csvexcel.SinFormula(c)
			}
			campos[i] = escapar(c)
		}
		sb.WriteString("\r\n")
		sb.WriteString(strings.Join(campos, ";"))
	}
	sb.WriteString("\r\n")
	return sb.String()
}

// InterpretarPrecio es InterpretarNumero sin negativos: un precio negativo es
// una columna mal mapeada, y vale más marcar la fila que guardarlo.
func InterpretarPrecio(bruto string) (string, bool) {
	n, ok := InterpretarNumero(bruto)
	if !ok || jsmath.Numero(n) < 0 {
		return "", false
	}
	return n, true
}

// FilaImportada es un renglón de la planilla subida, con su error si lo tiene.
type FilaImportada struct {
	Linea             int     `json:"linea"`
	Sku               string  `json:"sku"`
	PrecioGeneral     *string `json:"precioGeneral"`
	PrecioProfesional *string `json:"precioProfesional"`
	Error             string  `json:"error,omitempty"`
}

func precio(campos []string, i int) *string {
	if i < 0 {
		return nil
	}
	c := ""
	if i < len(campos) {
		c = campos[i]
	}
	if n, ok := InterpretarPrecio(c); ok {
		return &n
	}
	return nil
}

func indiceDe(columnas []string, cumple func(string) bool) int {
	for i, c := range columnas {
		if cumple(c) {
			return i
		}
	}
	return -1
}

// LeerFilas lee la planilla ya partida y devuelve una fila por renglón (sin
// contar los vacíos), con sus errores.
func LeerFilas(grilla [][]string) []FilaImportada {
	var lineas [][]string
	for _, fila := range grilla {
		for _, c := range fila {
			if trimJS(c) != "" {
				lineas = append(lineas, fila)
				break
			}
		}
	}
	if len(lineas) == 0 {
		return []FilaImportada{}
	}

	columnas := make([]string, len(lineas[0]))
	for i, c := range lineas[0] {
		columnas[i] = NormalizarEncabezado(c)
	}
	iSku := indiceDe(columnas, func(c string) bool { return strings.Contains(c, "sku") })
	iGeneral := indiceDe(columnas, func(c string) bool { return strings.Contains(c, "lista") || c == "precio" })
	iProfesional := indiceDe(columnas, func(c string) bool { return strings.Contains(c, "profesional") })

	if iSku == -1 {
		return []FilaImportada{{
			Linea: 1,
			Error: "La planilla no tiene la columna con el código del producto.",
		}}
	}

	salida := make([]FilaImportada, 0, len(lineas)-1)
	for i, campos := range lineas[1:] {
		linea := i + 2
		sku := ""
		if iSku < len(campos) {
			sku = trimJS(campos[iSku])
		}
		// La planilla que bajó de acá trae el apóstrofo de SinFormula
		// delante de un código que empieza con = + - @: vuelve sin él.
		if len(sku) > 1 && sku[0] == '\'' && csvexcel.SinFormula(sku[1:]) == sku {
			sku = sku[1:]
		}
		if sku == "" {
			salida = append(salida, FilaImportada{Linea: linea, Error: "Esta fila no tiene código de producto."})
			continue
		}
		general := precio(campos, iGeneral)
		profesional := precio(campos, iProfesional)
		if general == nil && profesional == nil {
			salida = append(salida, FilaImportada{Linea: linea, Sku: sku, Error: "No se pudo leer ningún precio de esta fila."})
			continue
		}
		salida = append(salida, FilaImportada{Linea: linea, Sku: sku, PrecioGeneral: general, PrecioProfesional: profesional})
	}
	return salida
}
