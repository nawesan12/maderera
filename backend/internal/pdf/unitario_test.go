package pdf

import "testing"

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
