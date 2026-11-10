package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"regexp"
	"strings"
	"time"

	"mjbj/internal/cola"
)

// Los audios (10/11/2026, Nahuel: el bot tiene que «escuchar audios»). Los
// transcribe whisper.cpp en la misma VPS —el servicio `whisper` del compose,
// con el modelo small cuantizado—: gratis, y el audio no sale del servidor.
// La transcripción queda en el mensaje (datos.transcripcion), se ve en la
// bandeja, y el bot la contesta como si la hubieran escrito.
//
// Va en su propio trabajo de la cola y no adentro del payload: una nota de
// voz tarda más o menos lo que dura, y el resto de los mensajes no tiene por
// qué esperarla.

// TrabajoAudio transcribe un audio y se lo pasa al bot.
const TrabajoAudio = "whatsapp.audio"

type cargaAudio struct {
	MensajeID      string `json:"mensajeId"`
	ConversacionID string `json:"conversacionId"`
	WaJid          string `json:"waJid"`
}

const textoSinAudio = "Por ahora no puedo escuchar audios. ¿Me lo escribís?"

// encolarAudio deja el audio para transcribir, o contesta que no se puede.
func (s *Servicio) encolarAudio(ctx context.Context, g *EntranteGuardado, waJid string) error {
	if s.cfg.WhisperURL == "" {
		return s.contestarSinTexto(ctx, g.ConversacionID, waJid)
	}
	_, err := cola.Encolar(ctx, s.q, TrabajoAudio, cargaAudio{g.MensajeID, g.ConversacionID, waJid}, time.Time{})
	return err
}

// contestarSinTexto: el bot, si está prendido y le toca, pide que lo
// escriban.
func (s *Servicio) contestarSinTexto(ctx context.Context, convID, waJid string) error {
	aj, err := s.ajustesBot(ctx)
	if err != nil || !aj.encendido {
		return err
	}
	var estado string
	if err := s.pool.QueryRow(ctx, `select bot_estado from whatsapp_conversaciones where id = $1`, convID).Scan(&estado); err != nil || estado != "activo" {
		return nil
	}
	_, err = s.EnviarYRegistrar(ctx, Envio{ConversacionID: convID, WaJid: waJid, Mensaje: Saliente{Tipo: "texto", Cuerpo: textoSinAudio},
		Registro: Registro{Cuerpo: textoSinAudio}, Origen: "bot"})
	return err
}

// atenderAudio es el trabajo: transcribe, guarda y contesta.
func (s *Servicio) atenderAudio(ctx context.Context, c cargaAudio) error {
	var ref *string
	if err := s.pool.QueryRow(ctx, `select media_url from whatsapp_mensajes where id = $1`, c.MensajeID).Scan(&ref); err != nil {
		return err
	}
	if ref == nil || *ref == "" {
		return s.contestarSinTexto(ctx, c.ConversacionID, c.WaJid)
	}
	contenido, mime := s.LeerPrivado(*ref)
	if len(contenido) == 0 {
		return s.contestarSinTexto(ctx, c.ConversacionID, c.WaJid)
	}
	texto, err := s.transcribir(ctx, contenido, mime)
	if err != nil {
		s.log.Warn("whatsapp: no se pudo transcribir el audio", "mensaje", c.MensajeID, "error", err)
		return s.contestarSinTexto(ctx, c.ConversacionID, c.WaJid)
	}
	if texto == "" {
		return s.contestarSinTexto(ctx, c.ConversacionID, c.WaJid)
	}
	if _, err := s.pool.Exec(ctx, `update whatsapp_mensajes set datos = coalesce(datos, '{}'::jsonb) || jsonb_build_object('transcripcion', $2::text) where id = $1`,
		c.MensajeID, texto); err != nil {
		return err
	}
	return s.atenderConBot(ctx, c.ConversacionID, c.WaJid, texto)
}

// transcribir le manda el audio a whisper-server (`POST /inference`). El
// servidor corre con `--convert`: el ogg/opus de WhatsApp lo pasa a wav con
// ffmpeg él mismo.
func (s *Servicio) transcribir(ctx context.Context, contenido []byte, mime string) (string, error) {
	var cuerpo bytes.Buffer
	w := multipart.NewWriter(&cuerpo)
	extension := "ogg"
	if i := strings.Index(mime, "/"); i >= 0 {
		extension = strings.SplitN(mime[i+1:], ";", 2)[0]
	}
	parte, err := w.CreateFormFile("file", "audio."+extension)
	if err != nil {
		return "", err
	}
	if _, err := parte.Write(contenido); err != nil {
		return "", err
	}
	_ = w.WriteField("response_format", "json")
	_ = w.WriteField("temperature", "0")
	if err := w.Close(); err != nil {
		return "", err
	}
	ctx, cancelar := context.WithTimeout(ctx, 4*time.Minute)
	defer cancelar()
	pedido, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.cfg.WhisperURL, "/")+"/inference", &cuerpo)
	if err != nil {
		return "", err
	}
	pedido.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := http.DefaultClient.Do(pedido)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("whisper respondió %d", resp.StatusCode)
	}
	var r struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return "", err
	}
	return limpiarTranscripcion(r.Text), nil
}

// limpiarTranscripcion saca lo que agrega Whisper y no dijo nadie: espacios,
// saltos y las marcas de silencio o música («[música]», «(silencio)»).
func limpiarTranscripcion(t string) string {
	t = reMarcasWhisper.ReplaceAllString(t, " ")
	return strings.TrimSpace(reEspaciosAudio.ReplaceAllString(t, " "))
}

var (
	reMarcasWhisper = regexp.MustCompile(`\[[^\]]*\]|\([^)]*\)`)
	reEspaciosAudio = regexp.MustCompile(`\s+`)
)
