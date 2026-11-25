package diagnostico

import (
	"strings"
	"testing"
)

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

// Los casos de tests/diagnostico.test.ts, que probaban el TS de antes.
func TestComoElTS(t *testing.T) {
	for m, quiere := range map[string]bool{
		"Minified React error #419; visit https://react.dev/errors/419":  true,
		"https://react.dev/errors/418?args[]=HTML":                       true,
		"The server could not finish this Suspense boundary":             true,
		"Hydration failed because the server rendered HTML didn't match": true,
		"https://react.dev/errors/4190":                                  false,
		"TypeError: x is undefined":                                      false,
	} {
		if EsErrorDeHidratacion(m) != quiere {
			t.Errorf("%q: %v", m, !quiere)
		}
	}
	m := "Minified React error #419"
	if r := Leer(map[string]any{"ruta": "/stock", "mensaje": m}); r == nil || *r != (Reporte{Ruta: "/stock", Mensaje: m}) {
		t.Errorf("reporte: %+v", r)
	}
	if Leer(map[string]any{"ruta": "https://otro.com/", "mensaje": m}) != nil || Leer(map[string]any{"ruta": "/stock", "mensaje": "hola"}) != nil || Leer(nil) != nil {
		t.Error("aceptó un reporte que no es")
	}
	largo := Leer(map[string]any{"ruta": "/stock", "mensaje": m + " " + string(make([]byte, 0)) + strings.Repeat("x", 5000), "pila": "a\nb\nc"})
	if largo == nil || len(largo.Mensaje) != 500 || largo.Pila != "a b c" {
		t.Errorf("recortes: %d %q", len(largo.Mensaje), largo.Pila)
	}
}
