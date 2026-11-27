package contenido

import (
	"strings"
	"testing"

	reglasdel "mjbj/internal/reglas"
)

// Toda regla de /admin/reglas dice en la bitácora lo que dice la pantalla,
// con cada una de sus opciones: diez salían con la clave cruda, como
// «Regla «cae_en_compras»: opcional → exigido» (mes 23, M2S4-052).
func TestCadaReglaTieneSusPalabras(t *testing.T) {
	todas := map[string][]string{}
	for k, v := range reglas {
		todas[k] = v
	}
	for k, v := range reglasdel.Opciones {
		todas[k] = v
	}
	for clave, opciones := range todas {
		texto, ok := textoDeRegla[clave]
		if !ok {
			t.Errorf("la regla %q no tiene texto", clave)
			continue
		}
		for _, o := range opciones {
			if _, ok := texto.opciones[o]; !ok {
				t.Errorf("la opción %q de %q no tiene texto", o, clave)
			}
		}
		if d := DescripcionDeRegla(clave, opciones[0], opciones[len(opciones)-1]); strings.Contains(d, clave) {
			t.Errorf("la bitácora dice la clave: %q", d)
		}
	}
}
