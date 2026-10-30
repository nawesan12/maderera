package planilla

import (
	"strings"
	"testing"
)

// La planilla de precios que se descarga no lleva fórmulas en los textos, y
// al subirla de vuelta el código vuelve sin el apóstrofo.
func TestPlanillaSinFormulas(t *testing.T) {
	csv := GenerarCsv([]FilaPlanilla{
		{Sku: "-FEN18", Producto: `=HYPERLINK("http://x")`, Medida: "@x", Categoria: "+y", PrecioGeneral: "-1.50", PrecioProfesional: "2"},
	})
	renglon := strings.Split(csv, "\r\n")[1]
	if esperado := `'-FEN18;"'=HYPERLINK(""http://x"")";'@x;'+y;-1,50;2`; renglon != esperado {
		t.Fatalf("renglón %q, quería %q", renglon, esperado)
	}

	filas := LeerFilas(PartirPlanilla(strings.TrimPrefix(csv, bom), ";"))
	if len(filas) != 1 || filas[0].Sku != "-FEN18" {
		t.Fatalf("al subirla de vuelta: %+v", filas)
	}
}
