package reportes

import "testing"

// «Next contestó 404:» con nada después (mes 23).
func TestErrorLegible(t *testing.T) {
	for _, c := range [][2]string{
		{"Next contestó 404:", "El sitio contestó 404."},
		{"Next contestó 404: ", "El sitio contestó 404."},
		{"Next contestó 500: falló", "El sitio contestó 500: falló"},
		{"El sitio no respondió: timeout", "El sitio no respondió: timeout"},
	} {
		if got := ErrorLegible(c[0]); got != c[1] {
			t.Errorf("%q: %q", c[0], got)
		}
	}
}
