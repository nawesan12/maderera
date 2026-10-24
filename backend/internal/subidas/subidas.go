// Package subidas guarda en disco las fotos de productos y los adjuntos
// (lib/almacenamiento.ts): las fotos en la carpeta pública, que sirve Caddy
// sin pasar por la aplicación, con un nombre al azar.
//
// Solo disco: Vercel Blob quedó atrás con la mudanza a la VPS.
package subidas

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Config es dónde se guarda.
type Config struct {
	Carpeta string `env:"CARPETA_SUBIDAS" envDefault:"/datos/subidas"`
}

// ErrSubida es un archivo que no se acepta, con el mensaje para la pantalla.
type ErrSubida struct{ Mensaje string }

func (e *ErrSubida) Error() string { return e.Mensaje }

// Los tipos y topes de lib/almacenamiento.ts.
const (
	topeImagen  = 8 << 20
	topeAdjunto = 16 << 20
)

var tiposDeImagen = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true, "image/avif": true}

var extensionesDeAdjunto = map[string]string{
	"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
	"audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/amr": "amr",
	"video/mp4": "mp4", "video/3gpp": "3gp",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":       "xlsx",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
	"text/plain": "txt", "text/csv": "csv",
}

// formatoDeImagen mira los primeros bytes, no lo que declaró quien subió el
// archivo: un .exe renombrado a .jpg no pasa.
func formatoDeImagen(b []byte) string {
	switch {
	case len(b) >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff:
		return "jpg"
	case len(b) >= 4 && b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G':
		return "png"
	}
	cab := string(b[:min(len(b), 12)])
	switch {
	case strings.HasPrefix(cab, "RIFF") && strings.Contains(cab, "WEBP"):
		return "webp"
	case strings.Contains(cab, "ftypavif"):
		return "avif"
	}
	return ""
}

func uuid() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b[:])
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

func mb(n int) string { return fmt.Sprintf("%.1f", float64(n)/1024/1024) }

// Disco guarda en la carpeta configurada.
type Disco struct{ carpeta string }

// Nuevo arma el almacenamiento.
func Nuevo(c Config) *Disco { return &Disco{carpeta: c.Carpeta} }

func (d *Disco) escribir(nombre string, datos []byte) error {
	if err := os.MkdirAll(d.carpeta, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(d.carpeta, nombre), datos, 0o644)
}

// GuardarImagen guarda una foto y devuelve su URL pública (/subidas/…).
func (d *Disco) GuardarImagen(datos []byte, tipoDeclarado, prefijo string) (string, error) {
	if len(datos) == 0 {
		return "", &ErrSubida{"El archivo está vacío."}
	}
	if len(datos) > topeImagen {
		return "", &ErrSubida{"La imagen pesa " + mb(len(datos)) + " MB. El máximo son 8 MB."}
	}
	if !tiposDeImagen[tipoDeclarado] {
		return "", &ErrSubida{"Subí una imagen en JPG, PNG, WebP o AVIF."}
	}
	formato := formatoDeImagen(datos)
	if formato == "" {
		return "", &ErrSubida{"El archivo no parece ser una imagen válida."}
	}
	if prefijo == "" {
		prefijo = "producto"
	}
	nombre := prefijo + "-" + uuid() + "." + formato
	if err := d.escribir(nombre, datos); err != nil {
		return "", err
	}
	return "/subidas/" + nombre, nil
}

// GuardarAdjunto guarda un adjunto (de WhatsApp, por ejemplo) con la
// extensión de su tipo.
func (d *Disco) GuardarAdjunto(datos []byte, mime, prefijo string) (string, error) {
	if len(datos) == 0 {
		return "", &ErrSubida{"El archivo llegó vacío."}
	}
	if len(datos) > topeAdjunto {
		return "", &ErrSubida{"El archivo pesa " + mb(len(datos)) + " MB y no lo podemos guardar."}
	}
	limpio := strings.ToLower(strings.TrimSpace(strings.SplitN(mime, ";", 2)[0]))
	ext, ok := extensionesDeAdjunto[limpio]
	if !ok {
		ext = "bin"
	}
	if prefijo == "" {
		prefijo = "whatsapp"
	}
	nombre := prefijo + "-" + uuid() + "." + ext
	if err := d.escribir(nombre, datos); err != nil {
		return "", err
	}
	return "/subidas/" + nombre, nil
}

var reNombre = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$`)

// NombreValido es nombreDeSubida: un nombre suelto, sin carpetas ni «..».
func NombreValido(nombre string) bool {
	return filepath.Base(nombre) == nombre && reNombre.MatchString(nombre) && !strings.Contains(nombre, "..")
}

// Borrar borra una foto por su URL. Si ya no estaba, no es error.
func (d *Disco) Borrar(url string) error {
	if !strings.HasPrefix(url, "/subidas/") {
		return nil
	}
	nombre := strings.TrimPrefix(url, "/subidas/")
	if !NombreValido(nombre) {
		return &ErrSubida{"Nombre de archivo inválido."}
	}
	err := os.Remove(filepath.Join(d.carpeta, nombre))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
