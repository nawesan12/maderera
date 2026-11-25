package busqueda

import "testing"

func TestNumero(t *testing.T) {
	casos := []struct {
		texto, digitos string
		es             bool
	}{
		{"223 555-1234", "2235551234", true},
		{"20-12345678-9", "20123456789", true},
		{"+54 9 223 555 1234", "5492235551234", true},
		{"Pérez 223", "", false},
		{"1234", "", false},
	}
	for _, c := range casos {
		d, es := Numero(c.texto)
		if d != c.digitos || es != c.es {
			t.Errorf("%q: %q %v", c.texto, d, es)
		}
	}
	if SinPrefijos("5492235551234") != "2235551234" {
		t.Error(SinPrefijos("5492235551234"))
	}
}
