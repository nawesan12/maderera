package cortes

// La lista de piezas para el optimizador de la seccionadora
// (lib/cortes/formatos.ts). El formato es configurable a propósito: no se vio
// todavía un archivo real del taller, y acertarle es prueba y error contra la
// máquina.

import (
	"encoding/json"
	"math"
	"regexp"
	"strings"

	"mjbj/internal/jsmath"
)

// Columnas son las columnas que se pueden poner en el archivo, en el orden
// de COLUMNAS del TS.
var Columnas = []struct{ Clave, Nombre string }{
	{"largo", "Largo"}, {"ancho", "Ancho"}, {"cantidad", "Cantidad"}, {"material", "Material"},
	{"etiqueta", "Etiqueta"}, {"veta", "Respeta veta"}, {"cantoLargo", "Canto largo"},
	{"cantoAncho", "Canto ancho"}, {"numero", "N° de corte"}, {"cliente", "Cliente"},
}

// EsClave dice si la clave es una de las columnas.
func EsClave(c string) bool {
	for _, x := range Columnas {
		if x.Clave == c {
			return true
		}
	}
	return false
}

// ColumnaConfigurada es una columna del perfil.
type ColumnaConfigurada struct {
	Clave      string `json:"clave"`
	Encabezado string `json:"encabezado"`
}

// PerfilDeExportacion es cómo se arma el archivo.
type PerfilDeExportacion struct {
	Nombre        string               `json:"nombre"`
	Separador     string               `json:"separador"`
	ConEncabezado bool                 `json:"conEncabezado"`
	Unidad        string               `json:"unidad"`
	Decimal       string               `json:"decimal"`
	SiNo          [2]string            `json:"siNo"`
	FinDeLinea    string               `json:"finDeLinea"`
	Columnas      []ColumnaConfigurada `json:"columnas"`
}

// PerfilGenerico es el punto de partida: un CSV que abre en Excel.
func PerfilGenerico() PerfilDeExportacion {
	return PerfilDeExportacion{
		Nombre: "Formato común (planilla)", Separador: ";", ConEncabezado: true, Unidad: "mm",
		Decimal: ",", SiNo: [2]string{"Sí", "No"}, FinDeLinea: "\r\n",
		Columnas: []ColumnaConfigurada{
			{"largo", "Largo"}, {"ancho", "Ancho"}, {"cantidad", "Cantidad"}, {"material", "Material"},
			{"etiqueta", "Etiqueta"}, {"veta", "Veta"}, {"cantoLargo", "Canto largo"}, {"cantoAncho", "Canto ancho"},
		},
	}
}

// FilaDePerfil es la fila de cutting_export_profiles que hace falta.
type FilaDePerfil struct {
	Nombre, Separador, Unidad, Decimal, ValorSi, ValorNo, FinDeLinea, Columnas string
	ConEncabezado                                                              bool
}

// APerfil traduce la fila al perfil (aPerfil del DAL): un JSON de columnas
// roto o vacío cae al genérico, y se quedan solo las columnas conocidas.
func APerfil(f FilaDePerfil) PerfilDeExportacion {
	var crudo []any
	columnas := PerfilGenerico().Columnas
	if err := json.Unmarshal([]byte(f.Columnas), &crudo); err == nil && len(crudo) > 0 {
		columnas = nil
		for _, x := range crudo {
			c, _ := x.(map[string]any)
			clave, _ := c["clave"].(string)
			enc, _ := c["encabezado"].(string)
			columnas = append(columnas, ColumnaConfigurada{clave, enc})
		}
	}
	filtradas := []ColumnaConfigurada{}
	for _, c := range columnas {
		if EsClave(c.Clave) {
			filtradas = append(filtradas, c)
		}
	}
	p := PerfilDeExportacion{
		Nombre: f.Nombre, Separador: f.Separador, ConEncabezado: f.ConEncabezado, Unidad: "mm",
		Decimal: ",", SiNo: [2]string{f.ValorSi, f.ValorNo}, FinDeLinea: "\r\n", Columnas: filtradas,
	}
	if f.Separador == "tab" {
		p.Separador = "\t"
	}
	if f.Unidad == "cm" || f.Unidad == "m" {
		p.Unidad = f.Unidad
	}
	if f.Decimal == "." {
		p.Decimal = "."
	}
	if f.FinDeLinea == "lf" {
		p.FinDeLinea = "\n"
	}
	return p
}

// PiezaParaExportar es un renglón del despiece.
type PiezaParaExportar struct {
	LargoMm     float64 `json:"largoMm"`
	AnchoMm     float64 `json:"anchoMm"`
	Cantidad    float64 `json:"cantidad"`
	RespetaVeta float64 `json:"respetaVeta"`
	CantoLargo  float64 `json:"cantoLargo"`
	CantoAncho  float64 `json:"cantoAncho"`
	Etiqueta    *string `json:"etiqueta"`
}

// CorteParaExportar es el trabajo.
type CorteParaExportar struct {
	Numero   string              `json:"numero"`
	Cliente  string              `json:"cliente"`
	Material string              `json:"material"`
	Piezas   []PiezaParaExportar `json:"piezas"`
}

// ConvertirMedida pasa de milímetros a la unidad del perfil sin dividir en
// punto flotante (1229/10 da 122.89999999999999).
func ConvertirMedida(mm float64, unidad, decimal string) string {
	if unidad == "mm" {
		return jsmath.Texto(jsmath.Round(mm))
	}
	divisor, ancho := 1000.0, 3
	if unidad == "cm" {
		divisor, ancho = 10, 1
	}
	entero := math.Trunc(mm / divisor)
	resto := math.Abs(math.Mod(mm, divisor))
	dec := jsmath.Texto(resto)
	if len(dec) < ancho {
		dec = strings.Repeat("0", ancho-len(dec)) + dec
	}
	return jsmath.Texto(entero) + decimal + dec
}

func escapar(valor, separador string) string {
	if strings.Contains(valor, separador) || strings.ContainsAny(valor, "\"\n\r") {
		return `"` + strings.ReplaceAll(valor, `"`, `""`) + `"`
	}
	return valor
}

// ArmarArchivoDeCorte arma el archivo entero (armarArchivoDeCorte).
func ArmarArchivoDeCorte(corte CorteParaExportar, perfil PerfilDeExportacion) string {
	si, no := perfil.SiNo[0], perfil.SiNo[1]
	canto := func(n float64) string {
		if n >= 2 {
			return "2"
		}
		if n == 1 {
			return si
		}
		return no
	}
	valorDe := func(p PiezaParaExportar, clave string) string {
		switch clave {
		case "largo":
			return ConvertirMedida(p.LargoMm, perfil.Unidad, perfil.Decimal)
		case "ancho":
			return ConvertirMedida(p.AnchoMm, perfil.Unidad, perfil.Decimal)
		case "cantidad":
			return jsmath.Texto(p.Cantidad)
		case "material":
			return corte.Material
		case "etiqueta":
			if p.Etiqueta == nil {
				return ""
			}
			return *p.Etiqueta
		case "veta":
			if p.RespetaVeta == 1 {
				return si
			}
			return no
		case "cantoLargo":
			return canto(p.CantoLargo)
		case "cantoAncho":
			return canto(p.CantoAncho)
		case "numero":
			return corte.Numero
		case "cliente":
			return corte.Cliente
		}
		return ""
	}

	var filas []string
	if perfil.ConEncabezado {
		cs := make([]string, len(perfil.Columnas))
		for i, c := range perfil.Columnas {
			cs[i] = escapar(c.Encabezado, perfil.Separador)
		}
		filas = append(filas, strings.Join(cs, perfil.Separador))
	}
	for _, p := range corte.Piezas {
		cs := make([]string, len(perfil.Columnas))
		for i, c := range perfil.Columnas {
			cs[i] = escapar(valorDe(p, c.Clave), perfil.Separador)
		}
		filas = append(filas, strings.Join(cs, perfil.Separador))
	}
	return strings.Join(filas, perfil.FinDeLinea) + perfil.FinDeLinea
}

var (
	reNoNombre = regexp.MustCompile(`[^A-Za-z0-9-]+`)
	reBordes   = regexp.MustCompile(`^_|_$`)
)

// NombreDeArchivo: «CRT-460» → «CRT-460.csv» (o .txt con tabulador).
func NombreDeArchivo(numero, separador string) string {
	limpio := reBordes.ReplaceAllString(reNoNombre.ReplaceAllString(numero, "_"), "")
	if separador == "\t" {
		return limpio + ".txt"
	}
	return limpio + ".csv"
}
