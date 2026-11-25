package jsmath

import (
	"math"
	"testing"
)

func TestNumeroComoJS(t *testing.T) {
	// Lo que da Number() en Node 22 para cada uno.
	for s, js := range map[string]float64{
		"": 0, "  ": 0, "12": 12, " 12 ": 12, "1e3": 1000, ".5": 0.5, "5.": 5, "+5": 5, "-2.5": -2.5,
		"0x10": 16, "0b101": 5, "0o17": 15, "Infinity": math.Inf(1), "-Infinity": math.Inf(-1), "1e999": math.Inf(1),
	} {
		if g := Numero(s); g != js {
			t.Errorf("Numero(%q) = %v, JS da %v", s, g, js)
		}
	}
	for _, s := range []string{"abc", "12abc", "inf", "nan", "NaN", "1_000", "1,5", "84.500.50", "0x", "--1", "1e", "0xZZ"} {
		if g := Numero(s); !math.IsNaN(g) {
			t.Errorf("Numero(%q) = %v, JS da NaN", s, g)
		}
	}
}
