package profesionales

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"mjbj/internal/zod"
)

// El golden sale de scripts/golden/campanas.ts (el TS real, en la zona de
// Buenos Aires) con APP_URL=https://mjbj.com.ar/.
const sitioGolden = "https://mjbj.com.ar/"

func leerGolden(t *testing.T, nombre string, destino any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "golden", "campanas", nombre))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, destino); err != nil {
		t.Fatal(err)
	}
}

type casoForm struct {
	Entrada map[string]any `json:"entrada"`
	Ok      bool           `json:"ok"`
	Campo   string         `json:"campo"`
	Mensaje string         `json:"mensaje"`
	Datos   map[string]any `json:"datos"`
}

func compararForm(t *testing.T, archivo string, validar func(map[string]any) *zod.Lector) {
	t.Helper()
	var casos []casoForm
	leerGolden(t, archivo, &casos)
	for i, c := range casos {
		l := validar(c.Entrada)
		campo, msj := l.Primero()
		if c.Ok != l.Ok() || campo != c.Campo || msj != c.Mensaje {
			t.Fatalf("%s %d %v: (%v %q %q), quería (%v %q %q)", archivo, i, c.Entrada, l.Ok(), campo, msj, c.Ok, c.Campo, c.Mensaje)
		}
		if c.Ok {
			for k, v := range c.Datos {
				if s, ok := v.(string); ok && l.Texto(k) != s {
					t.Fatalf("%s %d %s: %q, quería %q", archivo, i, k, l.Texto(k), s)
				}
			}
		}
	}
}

func TestGoldenFormularios(t *testing.T) {
	compararForm(t, "form-solicitud.json", func(m map[string]any) *zod.Lector { _, l := ValidarSolicitud(m); return l })
	compararForm(t, "form-aprobar.json", func(m map[string]any) *zod.Lector { _, _, _, l := ValidarAprobar(m); return l })
	compararForm(t, "form-rechazar.json", func(m map[string]any) *zod.Lector { _, _, l := ValidarRechazar(m); return l })
	compararForm(t, "form-evento.json", func(m map[string]any) *zod.Lector { _, l := ValidarEvento(m); return l })
	compararForm(t, "form-estado-evento.json", func(m map[string]any) *zod.Lector { _, _, l := ValidarEstadoEvento(m); return l })
	compararForm(t, "form-asistencia.json", func(m map[string]any) *zod.Lector { _, _, l := ValidarAsistencia(m); return l })
	compararForm(t, "form-anotarse.json", func(m map[string]any) *zod.Lector { _, l := ValidarAnotarse(m); return l })

	// El cupo, ya convertido.
	var casos []casoForm
	leerGolden(t, "form-evento.json", &casos)
	for _, c := range casos {
		if c.Ok {
			f, _ := ValidarEvento(c.Entrada)
			if float64(f.Cupo) != c.Datos["cupo"].(float64) {
				t.Fatalf("cupo %v: %d, quería %v", c.Entrada["cupo"], f.Cupo, c.Datos["cupo"])
			}
		}
	}
}

func TestGoldenSlugs(t *testing.T) {
	var casos []struct{ Titulo, Slug string }
	leerGolden(t, "slugs.json", &casos)
	for _, c := range casos {
		if got := ASlug(c.Titulo); got != c.Slug {
			t.Fatalf("%q: %q, quería %q", c.Titulo, got, c.Slug)
		}
	}
}

func TestGoldenFichas(t *testing.T) {
	var casos []struct {
		PorCuit    *Candidata `json:"porCuit"`
		PorUsuario *Candidata `json:"porUsuario"`
		UserID     *string    `json:"userId"`
		Decision   struct {
			Destino           *string `json:"destino"`
			Liberar           *string `json:"liberar"`
			VincularCuentaWeb bool    `json:"vincularCuentaWeb"`
		} `json:"decision"`
	}
	leerGolden(t, "fichas.json", &casos)
	for i, c := range casos {
		u := ""
		if c.UserID != nil {
			u = *c.UserID
		}
		got := DecidirFicha(c.PorCuit, c.PorUsuario, u)
		want := Decision{Destino: c.Decision.Destino, Liberar: c.Decision.Liberar, VincularCuentaWeb: c.Decision.VincularCuentaWeb}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%d %+v %+v %q: %+v, quería %+v", i, c.PorCuit, c.PorUsuario, u, got, want)
		}
	}
}

func TestGoldenAvisos(t *testing.T) {
	var casos []struct {
		Tipo          string  `json:"tipo"`
		Nombre        string  `json:"nombre"`
		Lista         *string `json:"lista"`
		LimiteCredito float64 `json:"limiteCredito"`
		Motivo        *string `json:"motivo"`
		Inicia        string  `json:"inicia"`
		Lugar         *string `json:"lugar"`
		Precio        float64 `json:"precio"`
		Cuando        string  `json:"cuando"`
		Correo        Correo  `json:"correo"`
	}
	leerGolden(t, "avisos.json", &casos)
	for i, c := range casos {
		var got Correo
		switch c.Tipo {
		case "acuse":
			got = AcuseDeRecibo(sitioGolden, c.Nombre)
		case "bienvenida":
			got = Bienvenida(sitioGolden, c.Nombre, c.Lista, c.LimiteCredito)
		case "rechazo":
			got = Rechazo(sitioGolden, c.Nombre, c.Motivo)
		case "confirmacion", "recordatorio":
			ini, _ := time.Parse(time.RFC3339, c.Inicia)
			if w := CuandoSeLee(ini); w != c.Cuando {
				t.Fatalf("%s: %q, quería %q", c.Inicia, w, c.Cuando)
			}
			if c.Tipo == "confirmacion" {
				got = Confirmacion(sitioGolden, DatosDelEvento{Nombre: "Ana", Evento: "Taller <WF>", Cuando: c.Cuando, Lugar: c.Lugar, Precio: c.Precio, Slug: "taller-wf"})
			} else {
				got = Recordatorio(sitioGolden, DatosDelEvento{Nombre: "Ana", Evento: "Taller & más", Cuando: c.Cuando, Lugar: c.Lugar, Slug: "taller"})
			}
		}
		if got != c.Correo {
			t.Fatalf("%d %s:\n got %#v\nwant %#v", i, c.Tipo, got, c.Correo)
		}
	}
}
