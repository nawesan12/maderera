package productos

import (
	"os"
	"regexp"
	"strconv"
	"testing"
)

// Next recorta el pedido de etiquetas a TOPE_DE_MEDIDAS antes de llamar acá:
// si los dos topes se separan, con más medidas que las que acepta Go la hoja
// vuelve a dar error.
func TestTopeDeEtiquetasIgualQueNext(t *testing.T) {
	ts, err := os.ReadFile("../../../lib/etiquetas-de-medidas.ts")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`export const TOPE_DE_MEDIDAS = (\d+);`).FindSubmatch(ts)
	if m == nil {
		t.Fatal("no está TOPE_DE_MEDIDAS en lib/etiquetas-de-medidas.ts")
	}
	if n, _ := strconv.Atoi(string(m[1])); n != TopeDeEtiquetas {
		t.Fatalf("Next corta en %d medidas y Go en %d", n, TopeDeEtiquetas)
	}
}
