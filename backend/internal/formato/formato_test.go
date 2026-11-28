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

// Decimal es formatearDecimal en modo texto: lo que escribe el bot.
func TestDecimal(t *testing.T) {
	casos := map[float64]string{4.32: "4,32", 0.5: "0,5", 12: "12", 1234.5: "1.234,5", 0: "0", 4.325: "4,33", -0.004: "0", -2.5: "-2,5", 9.5160000001: "9,52"}
	for v, quiere := range casos {
		if got := Decimal(v, 2); got != quiere {
			t.Errorf("Decimal(%v) = %q, quería %q", v, got, quiere)
		}
	}
}

func TestImporte(t *testing.T) {
	for v, quiere := range map[float64]string{
		50000: "$\u00a050.000", 50000.4: "$\u00a050.000,40", 3617000: "$\u00a03.617.000", -470: "-$\u00a0470",
		-0.004: "$\u00a00", 0: "$\u00a00", 0.05: "$\u00a00,05", 136390: "$\u00a0136.390", -1000.2: "-$\u00a01.000,20",
	} {
		if got := Importe(v); got != quiere {
			t.Errorf("Importe(%v) = %q, quería %q", v, got, quiere)
		}
	}
}

func TestTelefono(t *testing.T) {
	for entra, sale := range map[string]string{
		"2235550483":     "223 555-0483",
		"5492235550312":  "223 555-0312",
		"+5492235550312": "223 555-0312",
		"1145678901":     "11 4567-8901",
		"223 555-0205":   "223 555-0205",
		"4567":           "4567",
		"":               "",
	} {
		if got := Telefono(entra); got != sale {
			t.Errorf("Telefono(%q) = %q, quería %q", entra, got, sale)
		}
	}
}
