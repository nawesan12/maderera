package correo

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	gomail "github.com/wneessen/go-mail"
)

// Borrador es lo que se manda desde la pantalla de redactar.
type Borrador struct {
	Nombre string // el nombre con que sale («Ventas · Maderera Juan B. Justo»)
	Para   []string
	CC     []string
	CCO    []string
	Asunto string
	Texto  string
	HTML   string // opcional: si viene, va como alternativa del texto
	// Respuesta: el mensaje al que se contesta, para que el hilo quede
	// armado en el programa de quien lo recibe y marcar el original.
	EnRespuestaA string   // Message-ID del original
	Referencias  []string // las del original, más su Message-ID
	Carpeta      string   // dónde está el original
	UID          uint32
	Adjuntos     []ArchivoAdjunto
	// MessageID lo completa Enviar con el que le puso al mensaje.
	MessageID string
}

// ArchivoAdjunto es un archivo que se sube para mandar.
type ArchivoAdjunto struct {
	Nombre string
	Tipo   string
	Datos  []byte
}

// TopeAdjuntos es lo que acepta docker-mailserver por mensaje (25 MB), con
// lugar para lo que agrega el base64.
const TopeAdjuntos = 18 << 20

// Validar revisa el borrador y devuelve los errores por campo.
func (b *Borrador) Validar() map[string]string {
	errs := map[string]string{}
	revisar := func(campo string, lista []string) {
		for _, d := range lista {
			if _, err := mail.ParseAddress(d); err != nil {
				errs[campo] = fmt.Sprintf("«%s» no parece una dirección de correo.", d)
				return
			}
		}
	}
	if len(b.Para)+len(b.CC)+len(b.CCO) == 0 {
		errs["para"] = "Falta a quién mandarlo."
	}
	revisar("para", b.Para)
	revisar("cc", b.CC)
	revisar("cco", b.CCO)
	if len(b.Para)+len(b.CC)+len(b.CCO) > 100 {
		errs["para"] = "Son más de 100 destinatarios: para eso están las campañas del panel."
	}
	total := 0
	for _, a := range b.Adjuntos {
		total += len(a.Datos)
	}
	if total > TopeAdjuntos {
		errs["adjuntos"] = "Los adjuntos pasan los 18 MB. Mandalos en dos correos, o compartí un enlace."
	}
	if strings.ContainsAny(b.Asunto, "\r\n") {
		errs["asunto"] = "El asunto no puede tener saltos de línea."
	}
	return errs
}

// ErrRechazado es un envío que el servidor no aceptó (un destinatario que no
// existe en el propio dominio, el límite de envío).
var ErrRechazado = errors.New("el servidor de correo no aceptó el envío")

// Enviar manda el correo por SMTP con la misma casilla y clave de la sesión,
// guarda la copia en Enviados y marca el original como respondido.
//
// Si el envío sale pero guardar la copia falla, el correo **ya salió**: se
// devuelve sin error y se registra, porque reintentar lo mandaría dos veces.
func (s *Servidor) Enviar(ctx context.Context, cred Credenciales, b *Borrador, registrar func(string, error)) error {
	m := gomail.NewMsg()
	if err := m.FromFormat(b.Nombre, cred.Correo); err != nil {
		return fmt.Errorf("remitente: %w", err)
	}
	if len(b.Para) > 0 {
		if err := m.To(b.Para...); err != nil {
			return err
		}
	}
	if len(b.CC) > 0 {
		if err := m.Cc(b.CC...); err != nil {
			return err
		}
	}
	if len(b.CCO) > 0 {
		if err := m.Bcc(b.CCO...); err != nil {
			return err
		}
	}
	m.Subject(b.Asunto)
	m.SetDate()
	b.MessageID = nuevoMessageID(cred.Correo)
	m.SetMessageIDWithValue(b.MessageID)
	m.SetGenHeader(gomail.HeaderXMailer, "Correo MJBJ")
	if b.EnRespuestaA != "" {
		m.SetGenHeaderPreformatted(gomail.HeaderInReplyTo, "<"+b.EnRespuestaA+">")
		refs := make([]string, 0, len(b.Referencias))
		for _, r := range b.Referencias {
			refs = append(refs, "<"+r+">")
		}
		m.SetGenHeaderPreformatted(gomail.HeaderReferences, strings.Join(refs, " "))
	}
	m.SetBodyString(gomail.TypeTextPlain, b.Texto)
	if strings.TrimSpace(b.HTML) != "" {
		m.AddAlternativeString(gomail.TypeTextHTML, b.HTML)
	}
	for _, a := range b.Adjuntos {
		opciones := []gomail.FileOption{}
		if a.Tipo != "" {
			opciones = append(opciones, gomail.WithFileContentType(gomail.ContentType(a.Tipo)))
		}
		if err := m.AttachReader(a.Nombre, bytes.NewReader(a.Datos), opciones...); err != nil {
			return fmt.Errorf("adjuntando %q: %w", a.Nombre, err)
		}
	}

	opciones := []gomail.Option{
		gomail.WithPort(s.PuertoSMTP),
		gomail.WithSMTPAuth(gomail.SMTPAuthPlain),
		gomail.WithUsername(cred.Correo),
		gomail.WithPassword(cred.Clave),
		gomail.WithTLSConfig(s.tls()),
		gomail.WithTimeout(30 * time.Second),
	}
	if s.PuertoSMTP == 465 {
		opciones = append(opciones, gomail.WithSSL())
	} else {
		opciones = append(opciones, gomail.WithTLSPolicy(gomail.TLSMandatory))
	}
	cliente, err := gomail.NewClient(s.SMTP, opciones...)
	if err != nil {
		return fmt.Errorf("armando el cliente SMTP: %w", err)
	}
	if err := cliente.DialAndSendWithContext(ctx, m); err != nil {
		var envio *gomail.SendError
		if errors.As(err, &envio) && !envio.IsTemp() && envio.Reason == gomail.ErrSMTPRcptTo {
			return ErrRechazado
		}
		return fmt.Errorf("mandando: %w", err)
	}

	// Lo que sigue es prolijidad: el correo ya salió.
	var copia bytes.Buffer
	if _, err := m.WriteToSkipMiddleware(&copia, ""); err != nil {
		registrar("armando la copia para Enviados", err)
		return nil
	}
	if err := s.guardarEnviado(context.WithoutCancel(ctx), cred, copia.Bytes()); err != nil {
		registrar("guardando la copia en Enviados", err)
	}
	if b.Carpeta != "" && b.UID != 0 {
		if err := s.marcarRespondido(context.WithoutCancel(ctx), cred, b.Carpeta, b.UID); err != nil {
			registrar("marcando el original como respondido", err)
		}
	}
	return nil
}

func nuevoMessageID(remitente string) string {
	dominio := "mjbj.com.ar"
	if i := strings.LastIndexByte(remitente, '@'); i >= 0 {
		dominio = remitente[i+1:]
	}
	var b [12]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%x.%d@%s", b, time.Now().UnixNano(), dominio)
}
