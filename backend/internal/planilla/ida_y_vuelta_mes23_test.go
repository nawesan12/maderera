package planilla

import (
	"strings"
	"testing"
)

// La planilla exportada vuelve a leerse sin problemas (mes 23, M2S1-044):
// una medida sin precio de lista ni profesional sale con las celdas vacías
// y vuelve como «sin cambios», no como «No se pudo leer ningún precio».
func TestLaPlanillaExportadaVuelveALeerse(t *testing.T) {
	csv := GenerarCsv([]FilaPlanilla{
		{Sku: "DEC-ESC-PIN-MED", Producto: "Escalera a medida", Medida: "A medida", Categoria: "Decoración"},
		{Sku: "E2E-1", Producto: "Placa", Medida: "18 mm", Categoria: "Placas", PrecioGeneral: "28500.00"},
	})
	var grilla [][]string
	for _, l := range strings.Split(strings.TrimPrefix(strings.TrimSpace(csv), bom), "\r\n") {
		grilla = append(grilla, strings.Split(l, ";"))
	}
	filas := LeerFilas(grilla)
	if len(filas) != 2 || filas[0].Error != "" || filas[0].PrecioGeneral != nil || filas[1].Error != "" || *filas[1].PrecioGeneral != "28500.00" {
		t.Errorf("ida y vuelta: %+v", filas)
	}
	// Sin ninguna columna de precio, sí es un problema de cada fila.
	if f := LeerFilas([][]string{{"SKU", "Producto"}, {"X", "Y"}}); len(f) != 1 || f[0].Error == "" {
		t.Errorf("sin columnas de precio: %+v", f)
	}
}
