package whatsapp

import "testing"

func TestChequeEnLaPlantilla(t *testing.T) {
	banco := "Banco Nación"
	for _, c := range []struct {
		tipo  string
		banco *string
		want  string
	}{
		{"fisico", &banco, "Banco Nación N° 123"},
		{"echeq", &banco, "electrónico Banco Nación N° 123"},
		{"fisico", nil, "N° 123"},
	} {
		if got := ChequeEnLaPlantilla(c.tipo, c.banco, "123"); got != c.want {
			t.Errorf("%s: %q, se esperaba %q", c.tipo, got, c.want)
		}
	}
}
