package whatsapp

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Los adjuntos de las conversaciones, guardados fuera de lo público
// (lib/whatsapp/medios.ts): en CARPETA_PRIVADA, que Caddy no monta. Se leen
// solo por /api/whatsapp/medios/<id del mensaje>, con sesión de la bandeja.
// En la base queda una referencia (`privado:<nombre>`), nunca una URL.
//
// Los de Vercel Blob (de antes de la VPS) ya no se leen: el almacenamiento
// de Go es solo disco, como internal/subidas.

const prefijoPrivado = "privado:"

// TamanoMaximoMedio es el tope de WhatsApp para documentos (100 MB).
const TamanoMaximoMedio = 100 * 1024 * 1024

var extensiones = map[string]string{
	"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
	"audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
	"video/mp4": "mp4", "video/3gpp": "3gp",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         "xlsx",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   "docx",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
	"application/vnd.ms-excel": "xls", "application/msword": "doc", "application/vnd.ms-powerpoint": "ppt",
	"text/plain": "txt", "text/csv": "csv",
}

var tipoDeExtension = func() map[string]string {
	m := map[string]string{}
	for k, v := range extensiones {
		m[v] = k
	}
	return m
}()

// LimpiarMime es el tipo sin parámetros, en minúsculas.
func LimpiarMime(mime string) string {
	if mime == "" {
		mime = "application/octet-stream"
	}
	antes, _, _ := strings.Cut(mime, ";")
	return strings.ToLower(strings.TrimSpace(antes))
}

// GuardarPrivado guarda un adjunto y devuelve su referencia para la base.
func (s *Servicio) GuardarPrivado(contenido []byte, mime string) (string, int, error) {
	if len(contenido) == 0 {
		return "", 0, errors.New("El archivo llegó vacío.")
	}
	if len(contenido) > TamanoMaximoMedio {
		return "", 0, fmt.Errorf("El archivo pesa %.1f MB y no se puede guardar.", float64(len(contenido))/1024/1024)
	}
	ext, ok := extensiones[LimpiarMime(mime)]
	if !ok {
		ext = "bin"
	}
	nombre := "whatsapp-" + uuid() + "." + ext
	if err := os.MkdirAll(s.cfg.CarpetaPrivada, 0o755); err != nil {
		return "", 0, err
	}
	if err := os.WriteFile(filepath.Join(s.cfg.CarpetaPrivada, nombre), contenido, 0o644); err != nil {
		return "", 0, err
	}
	return prefijoPrivado + nombre, len(contenido), nil
}

var reNombreSubida = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$`)

// nombreSeguro es nombreDeSubida: solo el último tramo y solo caracteres de
// los que se generan acá, para que nadie lea fuera de la carpeta.
func nombreSeguro(n string) string {
	if filepath.Base(n) != n || !reNombreSubida.MatchString(n) {
		return ""
	}
	return n
}

// LeerPrivado lee un adjunto por su referencia; nil si no está.
func (s *Servicio) LeerPrivado(referencia string) ([]byte, string) {
	var ruta string
	switch {
	case strings.HasPrefix(referencia, prefijoPrivado):
		n := nombreSeguro(referencia[len(prefijoPrivado):])
		if n == "" {
			return nil, ""
		}
		ruta = filepath.Join(s.cfg.CarpetaPrivada, n)
	case strings.HasPrefix(referencia, "/subidas/"):
		// Los mensajes anteriores a los adjuntos privados quedaron en la carpeta pública.
		n := nombreSeguro(referencia[len("/subidas/"):])
		if n == "" {
			return nil, ""
		}
		ruta = filepath.Join(s.cfg.CarpetaSubidas, n)
	default:
		return nil, ""
	}
	b, err := os.ReadFile(ruta)
	if err != nil {
		return nil, ""
	}
	return b, mimeDeNombre(ruta)
}

func mimeDeNombre(n string) string {
	if t, ok := tipoDeExtension[strings.ToLower(strings.TrimPrefix(filepath.Ext(n), "."))]; ok {
		return t
	}
	return "application/octet-stream"
}

// TipoParaEnviar es el tipo de mensaje que corresponde a un archivo que sale.
// WhatsApp solo muestra como foto JPG y PNG; un WebP o un GIF van como documento.
func TipoParaEnviar(mime string) string {
	t := LimpiarMime(mime)
	switch {
	case t == "image/jpeg" || t == "image/png":
		return "image"
	case t == "video/mp4" || t == "video/3gpp":
		return "video"
	case strings.HasPrefix(t, "audio/"):
		return "audio"
	}
	return "document"
}
