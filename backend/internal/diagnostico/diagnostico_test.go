package diagnostico

import "testing"

func TestLeer(t *testing.T) {
	casos := []struct {
		cuerpo any
		vale   bool
	}{
		{map[string]any{"ruta": "/catalogo", "mensaje": "Hydration failed because the server rendered HTML didn't match"}, true},
		{map[string]any{"ruta": "/", "mensaje": "Minified React error #418; visit https://react.dev/errors/418"}, true},
		{map[string]any{"ruta": "/", "mensaje": "React error #4180"}, false},
		{map[string]any{"ruta": "/", "mensaje": "TypeError: x is undefined"}, false},
		{map[string]any{"ruta": "catalogo", "mensaje": "Hydration"}, false},
		{map[string]any{"ruta": "/", "mensaje": "   "}, false},
		{"no es un objeto", false},
	}
	for _, c := range casos {
		if r := Leer(c.cuerpo); (r != nil) != c.vale {
			t.Errorf("%v: %v", c.cuerpo, r)
		}
	}
	r := Leer(map[string]any{"ruta": "/a\nb", "mensaje": "hydrat " + string(make([]byte, 0)), "build": "0123456789012345678901234567890123456789XYZ"})
	if r == nil || r.Ruta != "/a b" || len(r.Build) != 40 {
		t.Errorf("recortes: %+v", r)
	}
}
