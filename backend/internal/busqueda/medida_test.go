package busqueda

import (
	"regexp"
	"testing"
)

func TestMedidaPorPor(t *testing.T) {
	re, ok := MedidaPorPor("2X4")
	if !ok {
		t.Fatal("2x4 es una medida")
	}
	// La misma expresión, en la sintaxis de Go (\W y clases son iguales).
	r := regexp.MustCompile("(?i)" + re)
	for texto, quiere := range map[string]bool{
		`2" x 4" x 3.60m`: true,
		`2x4`:             true,
		`Tirante 2 x 4`:   true,
		`1/2" x 4"`:       false,
		`12" x 4"`:        false,
		`2" x 45"`:        false,
		`2" x 4/5"`:       false,
		`1.2" x 4"`:       false,
	} {
		if r.MatchString(texto) != quiere {
			t.Errorf("%q: quería %v", texto, quiere)
		}
	}
	if _, ok := MedidaPorPor("pino"); ok {
		t.Error("pino no es una medida")
	}
}
