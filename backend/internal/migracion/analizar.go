package migracion

import (
	"strconv"

	"mjbj/internal/formato"
	"mjbj/internal/planilla"
)

// TopeDeBytes es lo más grande que se acepta: 8 MB.
const TopeDeBytes = 8 * 1024 * 1024

// TopeDeFilas es el tope por archivo. El histórico de ventas es otra escala
// que el maestro de artículos (entre 300 y 700 pedidos por mes, y se quiere
// traer entero): con el lote de 200 por transacción, el número grande no
// importa.
const TopeDeFilas = 100_000

// ArchivoAnalizado es el archivo leído, con el mapeo propuesto. No escribe
// nada: devuelve las filas crudas para que la pantalla valide, muestre y
// mande los lotes sin volver a subirlo.
type ArchivoAnalizado struct {
	Error        string     `json:"error,omitempty"`
	Archivo      string     `json:"archivo,omitempty"`
	Columnas     []string   `json:"columnas,omitempty"`
	Filas        [][]string `json:"filas,omitempty"`
	Codificacion string     `json:"codificacion,omitempty"`
	Mapeo        Mapeo      `json:"mapeo,omitempty"`
}

func errorDeArchivo(m string) ArchivoAnalizado { return ArchivoAnalizado{Error: m} }

// demasiadas es el mensaje de un archivo con más filas que el tope.
func demasiadas(n int) string {
	return "Son " + formato.Miles(strconv.Itoa(n)) + " filas y el tope por archivo es " +
		formato.Miles(strconv.Itoa(TopeDeFilas)) + ". Exportalo en partes."
}

// Analizar lee el archivo subido y propone el mapeo de columnas
// (analizarArchivo).
func Analizar(e Entidad, nombre string, datos []byte) ArchivoAnalizado {
	if len(datos) == 0 {
		return errorDeArchivo("Elegí un archivo.")
	}
	if len(datos) > TopeDeBytes {
		return errorDeArchivo("El archivo pasa los 8 MB. Exportalo en partes —por rubro, por letra, o por año si son ventas— y subilas de a una.")
	}
	leida := planilla.LeerPlanilla(datos)
	if leida.Error != "" {
		return errorDeArchivo(leida.Error)
	}
	if len(leida.Filas) < 2 {
		return errorDeArchivo("El archivo está vacío. Tiene que tener la fila de títulos y al menos una fila de datos.")
	}
	columnas, cuerpo := leida.Filas[0], leida.Filas[1:]
	if len(cuerpo) > TopeDeFilas {
		return errorDeArchivo(demasiadas(len(cuerpo)))
	}
	return ArchivoAnalizado{
		Archivo:      nombre,
		Columnas:     columnas,
		Filas:        cuerpo,
		Codificacion: leida.Codificacion,
		Mapeo:        Automapear(e, columnas),
	}
}
