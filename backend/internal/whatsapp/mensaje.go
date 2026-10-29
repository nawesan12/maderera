package whatsapp

import (
	"regexp"
	"strings"
)

// RefMedia es un adjunto que sale: ya subido a Meta (ID) o en un enlace.
type RefMedia struct {
	ID   string `json:"id,omitempty"`
	Link string `json:"link,omitempty"`
}

// Saliente es un mensaje que sale (MensajeSaliente de lib/whatsapp/tipos.ts).
// Se guarda tal cual en `datos.envio` del mensaje, con la forma del TS:
// reintentar un fallido es volver a mandar esto, y los guardados por el TS
// tienen que poder reintentarse desde Go.
type Saliente struct {
	Tipo          string    `json:"tipo"` // texto, media, plantilla, reaccion
	Cuerpo        string    `json:"cuerpo,omitempty"`
	Citado        *string   `json:"citado,omitempty"`
	Clase         string    `json:"clase,omitempty"` // image, document, audio, video
	Media         *RefMedia `json:"media,omitempty"`
	Epigrafe      *string   `json:"epigrafe,omitempty"`
	NombreArchivo *string   `json:"nombreArchivo,omitempty"`
	Nombre        string    `json:"nombre,omitempty"`
	Idioma        string    `json:"idioma,omitempty"`
	Componentes   []obj     `json:"componentes,omitempty"`
	AMensaje      string    `json:"aMensaje,omitempty"`
	Emoji         *string   `json:"emoji,omitempty"`
}

var reURL = regexp.MustCompile(`https?://`)

func vacioP(p *string) bool { return p == nil || *p == "" }

// CuerpoDelMensaje es el cuerpo de `POST /{phone-number-id}/messages`
// (cuerpoDelMensaje de proveedor-cloud.ts).
func CuerpoDelMensaje(destino string, m Saliente) obj {
	base := obj{"messaging_product": "whatsapp", "recipient_type": "individual"}
	if EsBsuid(destino) {
		base["recipient"] = destino
	} else {
		base["to"] = destino
	}
	contexto := func() {
		if !vacioP(m.Citado) {
			base["context"] = obj{"message_id": *m.Citado}
		}
	}
	switch m.Tipo {
	case "texto":
		contexto()
		base["type"] = "text"
		base["text"] = obj{"body": m.Cuerpo, "preview_url": reURL.MatchString(m.Cuerpo)}
	case "media":
		o := obj{}
		if m.Media != nil {
			if m.Media.ID != "" {
				o["id"] = m.Media.ID
			}
			if m.Media.Link != "" {
				o["link"] = m.Media.Link
			}
		}
		if m.Epigrafe != nil && trimJS(*m.Epigrafe) != "" && m.Clase != "audio" {
			o["caption"] = trimJS(*m.Epigrafe)
		}
		if m.Clase == "document" && !vacioP(m.NombreArchivo) {
			o["filename"] = *m.NombreArchivo
		}
		contexto()
		base["type"] = m.Clase
		base[m.Clase] = o
	case "plantilla":
		t := obj{"name": m.Nombre, "language": obj{"code": m.Idioma}}
		if len(m.Componentes) > 0 {
			t["components"] = m.Componentes
		}
		base["type"] = "template"
		base["template"] = t
	case "reaccion":
		emoji := ""
		if m.Emoji != nil {
			emoji = *m.Emoji
		}
		base["type"] = "reaction"
		base["reaction"] = obj{"message_id": m.AMensaje, "emoji": emoji}
	}
	return base
}

// MaxCuerpo es el largo máximo de un texto que entra.
const MaxCuerpo = 8000

// Limpiar saca los caracteres de control de un texto que llega de afuera
// (menos el salto de línea y la tabulación) y recorta el largo. No escapa
// HTML: lo escapa la pantalla al mostrarlo.
func Limpiar(texto string) string {
	var b strings.Builder
	for _, r := range texto {
		if r == '\n' || r == '\t' || (r > 0x1f && r != 0x7f) {
			b.WriteRune(r)
		}
	}
	return cortarJS(b.String(), MaxCuerpo)
}

var resumenDeTipo = map[string]string{
	"image":    "📷 Foto",
	"video":    "🎥 Video",
	"audio":    "🎤 Audio",
	"document": "📄 Documento",
	"sticker":  "Sticker",
	"location": "📍 Ubicación",
	"contacts": "👤 Contacto",
}

// Resumen es lo que se muestra del mensaje en la lista de conversaciones.
func Resumen(cuerpo, tipo string) string {
	t := colapsarEspaciosJS(trimJS(cuerpo))
	prefijo, hay := resumenDeTipo[tipo]
	if hay && t != "" && tipo != "location" && tipo != "contacts" {
		return cortarJS(prefijo+": "+t, 120)
	}
	if t != "" {
		return cortarJS(t, 120)
	}
	if hay {
		return prefijo
	}
	return "Mensaje"
}
