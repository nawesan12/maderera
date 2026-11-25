package sucursales

import (
	"os"
	"strings"
	"testing"
)

// La copia tiene que decir lo mismo que lib/sucursales.ts.
func TestIgualQueLibSucursales(t *testing.T) {
	ts, err := os.ReadFile("../../../lib/sucursales.ts")
	if err != nil {
		t.Skip("sin lib/ al lado (no es el repo entero)")
	}
	texto := string(ts)
	for _, s := range Publicadas {
		for _, dato := range []string{s.Slug, s.Nombre, s.Direccion, s.Telefono} {
			if !strings.Contains(texto, `"`+dato+`"`) {
				t.Errorf("%s: %q no está en lib/sucursales.ts", s.Slug, dato)
			}
		}
	}
}
