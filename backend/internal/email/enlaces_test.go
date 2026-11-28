package email

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
)

// El registro del modo demostración trae los enlaces del correo (mes
// simulado, M2S1-068, M2S2-119): sin ellos el link mágico y la firma del
// remito no se podían seguir sin leer el token de la base.
func TestElDemoRegistraLosEnlaces(t *testing.T) {
	var b bytes.Buffer
	d := &demo{log: slog.New(slog.NewTextHandler(&b, nil))}
	r := d.Enviar(context.Background(), Mensaje{
		Para:   "rocio@ejemplo.com",
		Asunto: "Tu link para entrar",
		HTML: `<p><a href="https://mjbj.iamnaw.dev/entrar/abc123">Entrar</a></p>
			<p>https://mjbj.iamnaw.dev/entrar/abc123</p><a href="mailto:hola@mjbj.com.ar">x</a>
			<a href="https://mjbj.iamnaw.dev/pedido/PED-1?t=tok&amp;x=1">Seguir</a>`,
		Texto: "Firmá acá: https://mjbj.iamnaw.dev/firmar/def456",
	})
	if !r.Simulado {
		t.Fatal(r)
	}
	quiero := []string{"https://mjbj.iamnaw.dev/entrar/abc123", "https://mjbj.iamnaw.dev/pedido/PED-1?t=tok&x=1", "https://mjbj.iamnaw.dev/firmar/def456"}
	got := EnlacesDe(`<a href="https://mjbj.iamnaw.dev/entrar/abc123">Entrar</a> https://mjbj.iamnaw.dev/entrar/abc123 <a href="mailto:a@b">m</a> <a href="https://mjbj.iamnaw.dev/pedido/PED-1?t=tok&amp;x=1">s</a>`,
		"Firmá acá: https://mjbj.iamnaw.dev/firmar/def456")
	if strings.Join(got, " ") != strings.Join(quiero, " ") {
		t.Fatalf("enlaces: %v", got)
	}
	for _, u := range quiero {
		if !strings.Contains(b.String(), u) {
			t.Errorf("el registro no trae %s:\n%s", u, b.String())
		}
	}
}
