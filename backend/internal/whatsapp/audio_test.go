package whatsapp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBotEscuchaAudios(t *testing.T) {
	e := armar(t, false)
	ctx := e.ctx
	if _, err := e.pool.Exec(ctx, `insert into site_settings (clave, valor) values ('whatsapp_bot', 'si')`); err != nil {
		t.Fatal(err)
	}
	var recibido string
	whisper := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/inference" || r.ParseMultipartForm(1<<20) != nil {
			http.Error(w, "mal", 400)
			return
		}
		f, h, _ := r.FormFile("file")
		defer f.Close()
		recibido = h.Filename
		_, _ = w.Write([]byte(`{"text":" [música] ¿A qué hora abren mañana? "}`))
	}))
	defer whisper.Close()

	audio := func(jid string) cargaAudio {
		t.Helper()
		conv, err := e.wa.ConversacionDe(ctx, jid, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		ref, _, err := e.wa.GuardarPrivado([]byte("OggS-audio-de-prueba"), "audio/ogg")
		if err != nil {
			t.Fatal(err)
		}
		var id string
		if err := e.pool.QueryRow(ctx, `insert into whatsapp_mensajes (conversacion_id, direccion, wa_message_id, tipo, media_url, media_mime, media_estado, estado, origen, ocurrido_at)
			values ($1, 'entrante', $2, 'audio', $3, 'audio/ogg', 'listo', 'entregado', 'cliente', now()) returning id`, conv.ID, "wamid."+jid, ref).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return cargaAudio{MensajeID: id, ConversacionID: conv.ID, WaJid: jid}
	}
	respuesta := func(jid string) string {
		var c string
		_ = e.pool.QueryRow(ctx, `select coalesce(string_agg(m.cuerpo, ' | '), '') from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
			where c.wa_jid = $1 and m.origen = 'bot'`, jid).Scan(&c)
		return c
	}

	// Con Whisper: se transcribe, queda en el mensaje y el bot contesta.
	e.wa.cfg.WhisperURL = whisper.URL
	c := audio("5492235550003")
	if err := e.wa.atenderAudio(ctx, c); err != nil {
		t.Fatal(err)
	}
	var transcripcion string
	_ = e.pool.QueryRow(ctx, `select datos->>'transcripcion' from whatsapp_mensajes where id = $1`, c.MensajeID).Scan(&transcripcion)
	if transcripcion != "¿A qué hora abren mañana?" || recibido != "audio.ogg" {
		t.Errorf("transcripción: %q (archivo %q)", transcripcion, recibido)
	}
	if r := respuesta(c.WaJid); !strings.Contains(r, "Casa Central") {
		t.Errorf("el bot tendría que contestar el horario: %q", r)
	}

	// Sin Whisper: pide que lo escriban.
	e.wa.cfg.WhisperURL = ""
	g := audio("5492235550004")
	if err := e.wa.encolarAudio(ctx, &EntranteGuardado{MensajeID: g.MensajeID, ConversacionID: g.ConversacionID}, g.WaJid); err != nil {
		t.Fatal(err)
	}
	if r := respuesta(g.WaJid); r != textoSinAudio {
		t.Errorf("sin whisper: %q", r)
	}
}
