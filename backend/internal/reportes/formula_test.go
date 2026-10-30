package reportes

import (
	"strings"
	"testing"
)

// El CSV de la reposición no lleva fórmulas en los textos, y los números
// negativos quedan como números.
func TestReposicionSinFormulas(t *testing.T) {
	sku := "+SKU"
	csv := CsvReposicion(ReporteDeReposicion{Filas: []FilaDeReposicion{{
		StockDeVariante: StockDeVariante{Producto: "=1+1", Medida: "-", Sku: &sku, Categoria: "@cat", DisponibleCentral: -3},
		Sugerido:        2,
	}}})
	renglon := strings.Split(csv, "\r\n")[1]
	if esperado := "'=1+1;'-;'+SKU;'@cat;;-3;0;0;;2"; renglon != esperado {
		t.Fatalf("renglón %q, quería %q", renglon, esperado)
	}
}
