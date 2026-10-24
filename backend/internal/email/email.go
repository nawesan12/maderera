// Package email manda los avisos de la tienda (pedidos, recibos, campañas):
// lib/email del TS con los mismos tres proveedores y la misma elección por
// variables de entorno.
//
//   - smtp: el servidor de correo propio (o el de Hostinger). Gana si está
//     configurado y nadie eligió otra cosa.
//   - resend: la API de Resend.
//   - demo: no manda nada, lo registra. Es lo que queda si no hay nada
//     configurado: una copia de prueba nunca le escribe a un cliente real.
package email

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	gomail "github.com/wneessen/go-mail"
)

// Adjunto es un archivo del mensaje.
type Adjunto struct {
	Nombre    string
	Contenido []byte
	Tipo      string
}

// Mensaje es un correo a mandar.
type Mensaje struct {
	Para       string
	Asunto     string
	HTML       string
	Texto      string
	ResponderA string
	Adjuntos   []Adjunto
	Cabeceras  map[string]string
}

// Resultado es lo que pasó. Temporal es un rechazo que vale reintentar (el
// tope de 5 por minuto de Hostinger, un corte de red): el aviso va a la cola.
type Resultado struct {
	Enviado  bool
	Simulado bool
	ID       string
	Error    string
	Temporal bool
}

// Proveedor manda.
type Proveedor interface {
	Nombre() string
	Real() bool
	Enviar(ctx context.Context, m Mensaje) Resultado
}

// Config son las variables de lib/email.
type Config struct {
	Proveedor    string `env:"EMAIL_PROVIDER"`
	Remitente    string `env:"EMAIL_REMITENTE" envDefault:"Maderera Juan B. Justo <pedidos@mjbj.com.ar>"`
	Respuestas   string `env:"EMAIL_RESPUESTAS"`
	ResendClave  string `env:"RESEND_API_KEY"`
	SMTPHost     string `env:"SMTP_HOST"`
	SMTPPuerto   int    `env:"SMTP_PUERTO" envDefault:"587"`
	SMTPUsuario  string `env:"SMTP_USUARIO"`
	SMTPClave    string `env:"SMTP_CLAVE"`
	SMTPNombreTL string `env:"SMTP_NOMBRE_TLS"`
}

func (c Config) hayResend() bool { return c.ResendClave != "" }
func (c Config) haySMTP() bool {
	return strings.TrimSpace(c.SMTPHost) != "" && strings.TrimSpace(c.SMTPUsuario) != "" && c.SMTPClave != ""
}

// Elegir es proveedorEmail() del TS.
func Elegir(c Config, log *slog.Logger) Proveedor {
	demo := &demo{log: log}
	switch strings.TrimSpace(c.Proveedor) {
	case "demo":
		return demo
	case "smtp":
		if c.haySMTP() {
			return &smtp{c: c}
		}
		return demo
	case "resend":
		if c.hayResend() {
			return &resend{c: c, cliente: &http.Client{Timeout: 30 * time.Second}}
		}
		return demo
	}
	if c.haySMTP() {
		return &smtp{c: c}
	}
	if c.hayResend() {
		return &resend{c: c, cliente: &http.Client{Timeout: 30 * time.Second}}
	}
	return demo
}

// --- demo ---

type demo struct{ log *slog.Logger }

func (*demo) Nombre() string { return "demo" }
func (*demo) Real() bool     { return false }
func (d *demo) Enviar(_ context.Context, m Mensaje) Resultado {
	nombres := make([]string, len(m.Adjuntos))
	for i, a := range m.Adjuntos {
		nombres[i] = a.Nombre
	}
	d.log.Info("email.demo", "para", m.Para, "asunto", m.Asunto, "adjuntos", nombres)
	return Resultado{Simulado: true}
}

// --- smtp ---

type smtp struct{ c Config }

func (*smtp) Nombre() string { return "smtp" }
func (*smtp) Real() bool     { return true }

var reNombre = regexp.MustCompile(`^\s*"?([^"<]+?)"?\s*<`)

// El servidor no deja que una casilla firme como otra (SPOOF_PROTECTION):
// sale con la dirección del usuario SMTP y el nombre de EMAIL_REMITENTE.
func (s *smtp) remitente() (string, string) {
	if m := reNombre.FindStringSubmatch(s.c.Remitente); m != nil {
		return strings.ReplaceAll(strings.TrimSpace(m[1]), `"`, ""), s.c.SMTPUsuario
	}
	return "", s.c.SMTPUsuario
}

func (s *smtp) Enviar(ctx context.Context, m Mensaje) Resultado {
	msg := gomail.NewMsg()
	nombre, direccion := s.remitente()
	if err := msg.FromFormat(nombre, direccion); err != nil {
		return Resultado{Error: err.Error()}
	}
	if err := msg.To(m.Para); err != nil {
		return Resultado{Error: err.Error()}
	}
	if r := firstNonEmpty(m.ResponderA, s.c.Respuestas); r != "" {
		_ = msg.ReplyTo(r)
	}
	msg.Subject(m.Asunto)
	msg.SetDate()
	msg.SetMessageID()
	for k, v := range m.Cabeceras {
		msg.SetGenHeader(gomail.Header(k), v)
	}
	msg.SetBodyString(gomail.TypeTextPlain, m.Texto)
	if m.HTML != "" {
		msg.AddAlternativeString(gomail.TypeTextHTML, m.HTML)
	}
	for _, a := range m.Adjuntos {
		_ = msg.AttachReader(a.Nombre, bytes.NewReader(a.Contenido), gomail.WithFileContentType(gomail.ContentType(a.Tipo)))
	}
	host := strings.TrimSpace(s.c.SMTPHost)
	tlsCfg := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
	// SMTP_NOMBRE_TLS solo vale para un host sin punto (el contenedor del
	// correo): con un servidor público se valida contra su propio nombre.
	if !strings.Contains(host, ".") && s.c.SMTPNombreTL != "" {
		tlsCfg.ServerName = s.c.SMTPNombreTL
	}
	opciones := []gomail.Option{
		gomail.WithPort(s.c.SMTPPuerto),
		gomail.WithSMTPAuth(gomail.SMTPAuthPlain),
		gomail.WithUsername(s.c.SMTPUsuario),
		gomail.WithPassword(s.c.SMTPClave),
		gomail.WithTLSConfig(tlsCfg),
		gomail.WithTimeout(60 * time.Second),
	}
	if s.c.SMTPPuerto == 465 {
		opciones = append(opciones, gomail.WithSSL())
	} else {
		opciones = append(opciones, gomail.WithTLSPolicy(gomail.TLSMandatory))
	}
	cliente, err := gomail.NewClient(host, opciones...)
	if err != nil {
		return Resultado{Error: err.Error()}
	}
	if err := cliente.DialAndSendWithContext(ctx, msg); err != nil {
		var se *gomail.SendError
		temporal := false
		if errors.As(err, &se) {
			temporal = se.IsTemp() || (se.ErrorCode() >= 400 && se.ErrorCode() < 500)
		} else {
			// No se pudo ni conectar: red, DNS, el servidor reiniciándose.
			temporal = true
		}
		return Resultado{Error: err.Error(), Temporal: temporal}
	}
	id := ""
	if v := msg.GetGenHeader(gomail.HeaderMessageID); len(v) > 0 {
		id = v[0]
	}
	return Resultado{Enviado: true, ID: id}
}

// --- resend ---

type resend struct {
	c       Config
	cliente *http.Client
}

func (*resend) Nombre() string { return "resend" }
func (*resend) Real() bool     { return true }

func (r *resend) Enviar(ctx context.Context, m Mensaje) Resultado {
	type adjunto struct {
		Filename    string `json:"filename"`
		Content     string `json:"content"`
		ContentType string `json:"content_type,omitempty"`
	}
	cuerpo := map[string]any{
		"from": r.c.Remitente, "to": []string{m.Para}, "subject": m.Asunto, "html": m.HTML, "text": m.Texto,
	}
	if rt := firstNonEmpty(m.ResponderA, r.c.Respuestas); rt != "" {
		cuerpo["reply_to"] = rt
	}
	if len(m.Cabeceras) > 0 {
		cuerpo["headers"] = m.Cabeceras
	}
	if len(m.Adjuntos) > 0 {
		var as []adjunto
		for _, a := range m.Adjuntos {
			as = append(as, adjunto{a.Nombre, base64.StdEncoding.EncodeToString(a.Contenido), a.Tipo})
		}
		cuerpo["attachments"] = as
	}
	crudo, _ := json.Marshal(cuerpo)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(crudo))
	req.Header.Set("Authorization", "Bearer "+r.c.ResendClave)
	req.Header.Set("Content-Type", "application/json")
	resp, err := r.cliente.Do(req)
	if err != nil {
		return Resultado{Error: err.Error(), Temporal: true}
	}
	defer resp.Body.Close()
	texto, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode/100 != 2 {
		t := string(texto)
		if len(t) > 300 {
			t = t[:300]
		}
		return Resultado{Error: fmt.Sprintf("Resend respondió %d: %s", resp.StatusCode, t), Temporal: resp.StatusCode == 429 || resp.StatusCode >= 500}
	}
	var datos struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(texto, &datos)
	return Resultado{Enviado: true, ID: datos.ID}
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}
