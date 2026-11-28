package pdf

import (
	"strings"
	"testing"
)

// El unitario con los decimales que hagan falta para que cantidad ×
// unitario dé el subtotal (M2S1-154, M3S2-063).
func TestUnitarioQueCierra(t *testing.T) {
	for _, c := range []struct {
		subtotal, cantidad float64
		quiero             string
	}{
		{294285.12, 5, "$ 58.857,024"},
		{23429.75, 10, "$ 2.342,975"},
		{10701, 13, "$ 823,154"},
		{24200, 2, "$ 12.100,00"},
		{100, 0, "$ 100,00"},
	} {
		if got := UnitarioQueCierra(c.subtotal, c.cantidad); got != c.quiero {
			t.Errorf("%v / %v: %q, quería %q", c.subtotal, c.cantidad, got, c.quiero)
		}
	}
}

// Recorrido M4-018 y M4-031: toda la columna con la misma precisión, la del
// renglón que más necesita, y cada renglón sigue cerrando.
func TestLaColumnaDelUnitarioVaConLaMismaPrecision(t *testing.T) {
	items := []ItemComprobante{
		{Cantidad: "20", Neto: "477685.95", Subtotal: "578000"},
		{Cantidad: "30", Neto: "277685.95", Subtotal: "336000"},
		{Cantidad: "2", Neto: "31834.71", Subtotal: "38520"},
	}
	d := decimalesDeLaColumna(items, true)
	if d != 4 {
		t.Fatalf("decimales: %d", d)
	}
	for _, it := range items {
		u := precioImpreso(it, true, d)
		if _, dec, _ := strings.Cut(u, ","); len(dec) != 4 {
			t.Errorf("%s: %q", it.Cantidad, u)
		}
	}
	if u := precioImpreso(items[2], true, d); u != "$ 15.917,3550" {
		t.Errorf("la laca: %q", u)
	}
	if d := decimalesDeLaColumna([]ItemComprobante{{Cantidad: "2", Neto: "24200", Subtotal: "29282"}}, true); d != 2 {
		t.Errorf("sin decimales de más: %d", d)
	}
}
