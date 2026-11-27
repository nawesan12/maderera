package whatsapp

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

// La derivación a una persona con un enlace corto (M2S2-139, M2S3-022). El
// wa.me con el texto codificado ocupaba cinco renglones en la burbuja del
// cliente, y llevaba solo el último mensaje: con «persona» se perdía el
// reclamo que había escrito antes. El bot manda
// <sitio>/api/whatsapp/hablar/<token>, que redirige al número humano con
// todo lo que escribió en la última hora.

// nuevoTokenDeDerivacion son 8 bytes al azar en base32: 13 letras.
func nuevoTokenDeDerivacion() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:]))
}

// textoDeDerivacion es lo que va escrito en el WhatsApp del número humano.
func textoDeDerivacion(entrantes []string) string {
	var partes []string
	for _, t := range entrantes {
		if t = trimJS(t); t != "" {
			partes = append(partes, t)
		}
	}
	return "Hola, vengo del WhatsApp automático. " + cortarJS(strings.Join(partes, "\n"), 600)
}

// guardarDerivacion deja el token y el texto: los mensajes del cliente de
// la última hora, en orden.
func (s *Servicio) guardarDerivacion(ctx context.Context, convID, token string) error {
	var textos []string
	if err := s.pool.QueryRow(ctx, `
		select coalesce(array_agg(coalesce(nullif(m.datos->>'transcripcion', ''), m.cuerpo, '') order by m.ocurrido_at, m.id), '{}')
		  from whatsapp_mensajes m
		 where m.conversacion_id = $1 and m.direccion = 'entrante' and m.ocurrido_at > now() - interval '1 hour'`, convID).Scan(&textos); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_derivacion_token = $2, bot_derivacion_texto = $3 where id = $1`,
		convID, token, textoDeDerivacion(textos))
	return err
}

// Hablar es el enlace de la derivación: lleva al WhatsApp del número humano
// con el texto escrito. Un token viejo (lo pisó una derivación nueva) lleva
// igual al número, sin texto; sin número humano, al sitio.
func (s *Servicio) Hablar(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	aj, err := s.ajustesBot(ctx)
	if err != nil {
		http.Error(w, "No pudimos abrir el enlace.", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if aj.numeroHumano == "" {
		http.Redirect(w, r, strings.TrimRight(s.cfg.URLBase, "/")+"/", http.StatusFound)
		return
	}
	destino := "https://wa.me/" + aj.numeroHumano
	var texto string
	err = s.pool.QueryRow(ctx, `select coalesce(bot_derivacion_texto, '') from whatsapp_conversaciones where bot_derivacion_token = $1`,
		cortarJS(r.PathValue("token"), 40)).Scan(&texto)
	switch {
	case err == nil && texto != "":
		destino = enlaceConTexto(aj.numeroHumano, texto)
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		s.log.Warn("whatsapp: no se pudo leer la derivación", "error", err)
	}
	http.Redirect(w, r, destino, http.StatusFound)
}
