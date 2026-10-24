package jsmath

import (
	"encoding/json"
	"math"
	"os"
	"strconv"
	"testing"
)

type caso struct {
	X, Round, R2, R2eps, Texto, Numero string
}

func deBits(t *testing.T, h string) float64 {
	t.Helper()
	u, err := strconv.ParseUint(h, 16, 64)
	if err != nil {
		t.Fatal(err)
	}
	return math.Float64frombits(u)
}

// Los casos los genera el JS de verdad (scripts/golden/jsmath.mjs). Se
// comparan los bits: -0 y 0 son distintos acá, y tienen que serlo.
func TestComoJS(t *testing.T) {
	crudo, err := os.ReadFile("../../testdata/golden/jsmath/redondeo.json")
	if err != nil {
		t.Fatal(err)
	}
	var casos []caso
	if err := json.Unmarshal(crudo, &casos); err != nil {
		t.Fatal(err)
	}
	if len(casos) < 6000 {
		t.Fatalf("faltan casos: %d", len(casos))
	}
	fallos := 0
	revisar := func(nombre string, x, got, want float64) {
		if math.Float64bits(got) != math.Float64bits(want) {
			fallos++
			if fallos <= 20 {
				t.Errorf("%s(%v) = %v, JS da %v", nombre, x, got, want)
			}
		}
	}
	for _, c := range casos {
		x := deBits(t, c.X)
		revisar("Round", x, Round(x), deBits(t, c.Round))
		revisar("Redondear2", x, Redondear2(x), deBits(t, c.R2))
		revisar("Redondear2Eps", x, Redondear2Eps(x), deBits(t, c.R2eps))
		// Leer el texto como lo lee JS (Number("…")): ParseFloat redondea
		// igual de bien.
		n, err := strconv.ParseFloat(c.Texto, 64)
		if err != nil {
			t.Fatalf("%q: %v", c.Texto, err)
		}
		revisar("ParseFloat", x, n, deBits(t, c.Numero))
	}
	if fallos > 0 {
		t.Fatalf("%d diferencias con JS", fallos)
	}
}
