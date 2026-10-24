package email

import (
	"context"
	"io"
	"log/slog"
	"testing"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

// La elección de proveedorEmail() en lib/email/index.ts, caso por caso.
func TestElegirComoElTS(t *testing.T) {
	smtpOK := Config{SMTPHost: "correo", SMTPUsuario: "avisos@mjbj.com.ar", SMTPClave: "x"}
	resendOK := Config{ResendClave: "re_x"}
	ambos := Config{SMTPHost: "correo", SMTPUsuario: "a@b.c", SMTPClave: "x", ResendClave: "re_x"}
	casos := []struct {
		nombre string
		c      Config
		want   string
	}{
		{"nada configurado: demo, nunca un cliente real", Config{}, "demo"},
		{"demo explícito gana aunque haya SMTP", Config{Proveedor: "demo", SMTPHost: "c", SMTPUsuario: "u", SMTPClave: "x"}, "demo"},
		{"smtp elegido y configurado", Config{Proveedor: "smtp", SMTPHost: "c", SMTPUsuario: "u", SMTPClave: "x"}, "smtp"},
		{"smtp elegido sin configurar: demo", Config{Proveedor: "smtp"}, "demo"},
		{"resend elegido aunque haya SMTP", Config{Proveedor: "resend", ResendClave: "re", SMTPHost: "c", SMTPUsuario: "u", SMTPClave: "x"}, "resend"},
		{"sin elegir, con SMTP", smtpOK, "smtp"},
		{"sin elegir, solo Resend", resendOK, "resend"},
		{"sin elegir, los dos: gana SMTP", ambos, "smtp"},
	}
	for _, c := range casos {
		if got := Elegir(c.c, silencio).Nombre(); got != c.want {
			t.Errorf("%s: %s, el TS elige %s", c.nombre, got, c.want)
		}
	}
	if r := Elegir(Config{}, silencio).Enviar(context.Background(), Mensaje{Para: "cliente@real.com"}); r.Enviado || !r.Simulado {
		t.Errorf("demo: %+v", r)
	}
}

func TestRemitenteConLaCasillaDelUsuario(t *testing.T) {
	s := &smtp{c: Config{SMTPUsuario: "avisos@mjbj.com.ar", Remitente: `"Maderera Juan B. Justo" <pedidos@mjbj.com.ar>`}}
	if n, d := s.remitente(); n != "Maderera Juan B. Justo" || d != "avisos@mjbj.com.ar" {
		t.Errorf("remitente: %q <%s>", n, d)
	}
	s.c.Remitente = "solo-una-direccion@mjbj.com.ar"
	if n, d := s.remitente(); n != "" || d != "avisos@mjbj.com.ar" {
		t.Errorf("sin nombre: %q <%s>", n, d)
	}
}
