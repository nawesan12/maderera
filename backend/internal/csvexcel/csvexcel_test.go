package csvexcel

import (
	"encoding/json"
	"math"
	"os"
	"strconv"
	"testing"
	"time"
)

// Golden contra lib/csv-excel.ts (scripts/golden/csv-excel.ts), con la zona
// de Argentina.
func TestComoElTS(t *testing.T) {
	crudo, err := os.ReadFile("../../testdata/golden/csvexcel/casos.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		NumeroCsv []struct {
			V json.RawMessage `json:"v"`
			D int             `json:"d"`
			S string          `json:"s"`
		} `json:"numeroCsv"`
		NumeroCsv2 []struct {
			V json.RawMessage `json:"v"`
			S string          `json:"s"`
		} `json:"numeroCsv2"`
		EnteroCsv []struct {
			V json.RawMessage `json:"v"`
			S string          `json:"s"`
		} `json:"enteroCsv"`
		TextoCsv []struct {
			T *string `json:"t"`
			S string  `json:"s"`
		} `json:"textoCsv"`
		FechaCsv []struct {
			F *time.Time `json:"f"`
			S string     `json:"s"`
		} `json:"fechaCsv"`
		ArmarCsv []struct {
			Encabezados []string   `json:"encabezados"`
			Filas       [][]string `json:"filas"`
			Totales     []string   `json:"totales"`
			Salida      string     `json:"salida"`
		} `json:"armarCsv"`
	}
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	num := func(r json.RawMessage) float64 {
		var s string
		if json.Unmarshal(r, &s) == nil {
			switch s {
			case "-0":
				return math.Copysign(0, -1)
			case "NaN":
				return math.NaN()
			case "Infinity":
				return math.Inf(1)
			case "-Infinity":
				return math.Inf(-1)
			}
		}
		v, err := strconv.ParseFloat(string(r), 64)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	for _, c := range g.NumeroCsv {
		if got := NumeroCsv(num(c.V), c.D); got != c.S {
			t.Errorf("NumeroCsv(%s, %d) = %q, TS %q", c.V, c.D, got, c.S)
		}
	}
	for _, c := range g.NumeroCsv2 {
		if got := NumeroCsv(num(c.V), 2); got != c.S {
			t.Errorf("NumeroCsv(%s) = %q, TS %q", c.V, got, c.S)
		}
	}
	for _, c := range g.EnteroCsv {
		if got := EnteroCsv(num(c.V)); got != c.S {
			t.Errorf("EnteroCsv(%s) = %q, TS %q", c.V, got, c.S)
		}
	}
	for _, c := range g.TextoCsv {
		if got := TextoCsv(c.T); got != c.S {
			t.Errorf("TextoCsv(%v) = %q, TS %q", c.T, got, c.S)
		}
	}
	for _, c := range g.FechaCsv {
		if got := FechaCsv(c.F); got != c.S {
			t.Errorf("FechaCsv(%v) = %q, TS %q", c.F, got, c.S)
		}
	}
	for i, c := range g.ArmarCsv {
		if got := ArmarCsv(c.Encabezados, c.Filas, c.Totales); got != c.Salida {
			t.Errorf("ArmarCsv #%d = %q, TS %q", i, got, c.Salida)
		}
	}
	if n := len(g.NumeroCsv) + len(g.EnteroCsv) + len(g.TextoCsv) + len(g.FechaCsv) + len(g.ArmarCsv); n < 10000 {
		t.Errorf("pocos casos: %d", n)
	}
}

// El arreglo de la zona: un pago a las 22:30 del 5/3 en Buenos Aires es el
// 5/3, aunque en UTC ya sea el 6.
func TestFechaEnArgentina(t *testing.T) {
	noche := time.Date(2026, 3, 6, 1, 30, 0, 0, time.UTC)
	if got := FechaCsv(&noche); got != "05/03/2026" {
		t.Errorf("FechaCsv = %q", got)
	}
}
