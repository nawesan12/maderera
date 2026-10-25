package email

import (
	"encoding/json"
	"math"
	"os"
	"strconv"
	"strings"
	"testing"

	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
)

// Number() de JS sobre lo que el golden trae como número o texto.
func numeroJS(t *testing.T, crudo json.RawMessage) *float64 {
	if len(crudo) == 0 || string(crudo) == "null" {
		return nil
	}
	var v any
	if err := json.Unmarshal(crudo, &v); err != nil {
		t.Fatal(err)
	}
	switch x := v.(type) {
	case float64:
		return &x
	case string:
		n, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil {
			n = math.NaN()
		}
		return &n
	}
	t.Fatalf("número raro: %s", crudo)
	return nil
}

func textoJS(crudo json.RawMessage) string {
	var v any
	_ = json.Unmarshal(crudo, &v)
	if n, ok := v.(float64); ok {
		return jsmath.Texto(n)
	}
	s, _ := v.(string)
	return s
}

func TestEnvolverComoElTS(t *testing.T) {
	crudo, err := os.ReadFile("../../testdata/golden/email/envolver.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		Sitio    string
		Envolver []struct {
			Opciones struct {
				Titulo, Adelanto, Saludo, Cierre string
				Parrafos                         []string
				Datos                            []Bloque
				Lineas                           []struct {
					Descripcion string
					Cantidad    json.RawMessage
					Unidad      *string
					Importe     json.RawMessage
				}
				Total  json.RawMessage
				CTA    *Enlace `json:"cta"`
				Imagen *Imagen
				Pie    *Pie
			}
			HTML, Texto string
		}
		Escapar []struct{ T, R string }
		Precios []struct {
			V json.RawMessage
			R string
		}
	}
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	for i, c := range g.Envolver {
		o := Opciones{
			Titulo: c.Opciones.Titulo, Adelanto: c.Opciones.Adelanto, Saludo: c.Opciones.Saludo, Cierre: c.Opciones.Cierre,
			Parrafos: c.Opciones.Parrafos, Datos: c.Opciones.Datos, Total: numeroJS(t, c.Opciones.Total),
			CTA: c.Opciones.CTA, Imagen: c.Opciones.Imagen, Pie: c.Opciones.Pie,
		}
		for _, l := range c.Opciones.Lineas {
			u := ""
			if l.Unidad != nil {
				u = *l.Unidad
			}
			o.Lineas = append(o.Lineas, LineaCorreo{Descripcion: l.Descripcion, Cantidad: textoJS(l.Cantidad), Unidad: u, Importe: numeroJS(t, l.Importe)})
		}
		html, texto := Envolver(g.Sitio, o)
		if html != c.HTML {
			t.Errorf("caso %d: el HTML difiere\n--- go\n%s\n--- ts\n%s", i, html, c.HTML)
		}
		if texto != c.Texto {
			t.Errorf("caso %d: el texto difiere\n--- go\n%q\n--- ts\n%q", i, texto, c.Texto)
		}
	}
	for _, c := range g.Escapar {
		if r := Escapar(c.T); r != c.R {
			t.Errorf("Escapar(%q) = %q, el TS da %q", c.T, r, c.R)
		}
	}
	for _, c := range g.Precios {
		if r := formato.PrecioONulo(numeroJS(t, c.V)); r != c.R {
			t.Errorf("Precio(%s) = %q, el TS da %q", c.V, r, c.R)
		}
	}
}
