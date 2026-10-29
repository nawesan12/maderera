package formato

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

func TestNumerosComoIntl(t *testing.T) {
	crudo, err := os.ReadFile("../../testdata/golden/formato/numeros.json")
	if err != nil {
		t.Fatal(err)
	}
	var casos []struct {
		V              float64
		Moneda, Numero string
	}
	if err := json.Unmarshal(crudo, &casos); err != nil {
		t.Fatal(err)
	}
	// JSON no guarda el -0: el segundo caso del golden es -0.
	casos[1].V = math.Copysign(0, -1)
	for _, c := range casos {
		if r := Moneda(c.V); r != c.Moneda {
			t.Errorf("Moneda(%v) = %q, Intl %q", c.V, r, c.Moneda)
		}
		if r := Numero(c.V); r != c.Numero {
			t.Errorf("Numero(%v) = %q, Intl %q", c.V, r, c.Numero)
		}
	}
}
