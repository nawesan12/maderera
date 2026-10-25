package planilla

import "fmt"

// PlanillaLeida es una planilla subida, venga como CSV o como .xlsx: una
// grilla de textos, cómo se leyó y, si no se pudo, por qué.
type PlanillaLeida struct {
	Filas [][]string `json:"filas"`
	// Codificacion se muestra en pantalla y se guarda en la corrida:
	// "utf-8", "windows-1252", `xlsx · hoja "Precios"`, "xls", "pdf".
	Codificacion string `json:"codificacion"`
	Error        string `json:"error,omitempty"`
}

var noSePuede = map[string]string{
	"xls": "un Excel viejo (.xls)",
	"pdf": "un PDF",
}

// LeerPlanilla es el único punto por el que entra un archivo del cliente: la
// migración y la importación de precios ven lo mismo.
func LeerPlanilla(datos []byte) PlanillaLeida {
	binario := FormatoBinario(datos)

	if binario == "xlsx" {
		filas, hoja, err := LeerXlsx(datos)
		if err != nil {
			return PlanillaLeida{
				Filas:        [][]string{},
				Codificacion: "xlsx",
				Error:        "No se pudo abrir el Excel: " + err.Error(),
			}
		}
		return PlanillaLeida{Filas: filas, Codificacion: fmt.Sprintf(`xlsx · hoja "%s"`, hoja)}
	}

	if binario != "" {
		return PlanillaLeida{
			Filas:        [][]string{},
			Codificacion: binario,
			Error: "Esto es " + noSePuede[binario] + ". Hace falta un Excel (.xlsx) o un CSV: si el sistema " +
				"anterior solo exporta a este formato, abrilo en Excel y guardalo como .xlsx.",
		}
	}

	texto, codificacion := DecodificarPlanilla(datos)
	return PlanillaLeida{Filas: PartirPlanilla(texto, DetectarSeparador(texto)), Codificacion: codificacion}
}
