package campanas

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"mjbj/internal/zod"
)

// El golden sale de scripts/golden/campanas.ts (el TS real) con
// APP_URL=https://mjbj.com.ar/ y este secreto.
const (
	sitioGolden   = "https://mjbj.com.ar/"
	secretoGolden = "secreto-de-prueba-de-las-bajas-32-caracteres"
)

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

func TestGoldenCuerpo(t *testing.T) {
	var casos []struct {
		Cuerpo   string           `json:"cuerpo"`
		Bloques  []BloqueDeCuerpo `json:"bloques"`
		Parrafos []string         `json:"parrafos"`
	}
	leerGolden(t, "cuerpo.json", &casos)
	for i, c := range casos {
		if got := LeerCuerpo(c.Cuerpo); !reflect.DeepEqual(got, c.Bloques) {
			t.Fatalf("caso %d %q:\n got %#v\nwant %#v", i, c.Cuerpo, got, c.Bloques)
		}
		if got := CuerpoComoParrafos(c.Cuerpo); !reflect.DeepEqual(got, c.Parrafos) {
			t.Fatalf("caso %d párrafos %q:\n got %q\nwant %q", i, c.Cuerpo, got, c.Parrafos)
		}
	}
}

func cadena(p *string) string {
	if p == nil {
		return "<null>"
	}
	return *p
}

func verifica(e, t, s string) *string {
	if c, ok := VerificarBaja(e, t, s); ok {
		return &c
	}
	return nil
}

func TestGoldenBajas(t *testing.T) {
	var casos []struct {
		Email, Normal, E, T                    string
		Verifica, ConOtraFirma, ConOtroSecreto *string
		FirmaCorta, SinFirma                   *string
	}
	leerGolden(t, "bajas.json", &casos)
	for i, c := range casos {
		if n := NormalizarCorreo(c.Email); n != c.Normal {
			t.Fatalf("%d normalizar %q: %q, quería %q", i, c.Email, n, c.Normal)
		}
		e, f := ParametrosDeBaja(c.Email, secretoGolden)
		if e != c.E || f != c.T {
			t.Fatalf("%d parámetros %q: %s %s, quería %s %s", i, c.Email, e, f, c.E, c.T)
		}
		_, otra := ParametrosDeBaja(c.Email+"x", secretoGolden)
		for _, p := range []struct {
			nombre    string
			got, want *string
		}{
			{"verifica", verifica(e, f, secretoGolden), c.Verifica},
			{"otra firma", verifica(e, otra, secretoGolden), c.ConOtraFirma},
			{"otro secreto", verifica(e, f, secretoGolden+"!"), c.ConOtroSecreto},
			{"firma corta", verifica(e, f[:31], secretoGolden), c.FirmaCorta},
			{"sin firma", verifica(e, "", secretoGolden), c.SinFirma},
		} {
			if cadena(p.got) != cadena(p.want) {
				t.Fatalf("%d %s %q: %s, quería %s", i, p.nombre, c.Email, cadena(p.got), cadena(p.want))
			}
		}
	}

	var dec []struct {
		E     string  `json:"e"`
		Email *string `json:"email"`
	}
	leerGolden(t, "decodificar.json", &dec)
	for i, d := range dec {
		var got *string
		if c, ok := DecodificarCorreo(d.E); ok {
			got = &c
		}
		if cadena(got) != cadena(d.Email) {
			t.Fatalf("%d decodificar %q: %s, quería %s", i, d.E, cadena(got), cadena(d.Email))
		}
	}
}

func TestGoldenSegmento(t *testing.T) {
	var casos []struct {
		Datos       DatosDeSegmento `json:"datos"`
		Segmento    Segmento        `json:"segmento"`
		Descripcion string          `json:"descripcion"`
	}
	leerGolden(t, "segmentos.json", &casos)
	for i, c := range casos {
		s := LeerSegmento(c.Datos)
		if !reflect.DeepEqual(s, c.Segmento) {
			t.Fatalf("%d %+v: %+v, quería %+v", i, c.Datos, s, c.Segmento)
		}
		if d := DescribirSegmento(s); d != c.Descripcion {
			t.Fatalf("%d: %q, quería %q", i, d, c.Descripcion)
		}
	}
	var dur []struct {
		Cantidad, PorMinuto int
		Texto               string
	}
	leerGolden(t, "duraciones.json", &dur)
	for _, d := range dur {
		if got := DuracionDelEnvio(d.Cantidad, d.PorMinuto); got != d.Texto {
			t.Fatalf("%d a %d por minuto: %q, quería %q", d.Cantidad, d.PorMinuto, got, d.Texto)
		}
	}
}

func TestGoldenCorreo(t *testing.T) {
	var casos []struct {
		Campana      ParaArmar `json:"campana"`
		Destinatario struct {
			Email  string  `json:"email"`
			Nombre *string `json:"nombre"`
		} `json:"destinatario"`
		Correo Correo `json:"correo"`
	}
	leerGolden(t, "correos.json", &casos)
	for i, c := range casos {
		got := ArmarCorreo(sitioGolden, secretoGolden, c.Campana, c.Destinatario.Email, val(c.Destinatario.Nombre))
		if !reflect.DeepEqual(got, c.Correo) {
			t.Fatalf("%d:\n got %#v\nwant %#v", i, got, c.Correo)
		}
	}
	var nombres []struct{ Nombre, Primero string }
	leerGolden(t, "primer-nombre.json", &nombres)
	for _, n := range nombres {
		if got := PrimerNombre(n.Nombre); got != n.Primero {
			t.Fatalf("%q: %q, quería %q", n.Nombre, got, n.Primero)
		}
	}
}

// casoForm es un caso de un formulario: el primer error o los datos.
type casoForm struct {
	Entrada map[string]any `json:"entrada"`
	Ok      bool           `json:"ok"`
	Campo   string         `json:"campo"`
	Mensaje string         `json:"mensaje"`
	Datos   map[string]any `json:"datos"`
}

// CompararForm corre un formulario contra su golden.
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
	compararForm(t, "form-campana.json", func(m map[string]any) *zod.Lector { _, l := ValidarCampana(m); return l })
	compararForm(t, "form-aviso.json", func(m map[string]any) *zod.Lector { _, _, l := ValidarAvisoActivo(m); return l })
	compararForm(t, "form-aviso-texto.json", func(m map[string]any) *zod.Lector { _, _, _, l := ValidarAvisoTexto(m); return l })

	var prog []struct {
		Cuando string  `json:"cuando"`
		ISO    *string `json:"iso"`
	}
	leerGolden(t, "programar.json", &prog)
	for _, p := range prog {
		f, ok := LeerHoraLocal(p.Cuando)
		// "" y "x" el Date de V8 los lee como el 1/1/2000 (su lector
		// heredado); el TS terminaba igual en un error («usá Enviar ahora»).
		if p.Cuando == "" || p.Cuando == "x" {
			if ok {
				t.Fatalf("%q debería ser inválida", p.Cuando)
			}
			continue
		}
		got := "<null>"
		if ok {
			got = f.UTC().Format("2006-01-02T15:04:05.000Z")
		}
		if got != cadena(p.ISO) {
			t.Fatalf("%q: %s, quería %s", p.Cuando, got, cadena(p.ISO))
		}
	}
	_ = time.Now
}
