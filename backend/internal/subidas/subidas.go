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
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Config es dónde se guarda: lo público (que sirve Caddy) y lo privado
// (comprobantes de transferencias, documentos técnicos), que solo se lee por
// una ruta de la API que mira quién pide. La privada es la misma carpeta de
// los adjuntos de WhatsApp.
type Config struct {
	Carpeta        string `env:"CARPETA_SUBIDAS" envDefault:"/datos/subidas"`
	CarpetaPrivada string `env:"CARPETA_PRIVADA" envDefault:"/datos/privado"`
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

// Disco guarda en las carpetas configuradas.
type Disco struct{ carpeta, privada string }

// Nuevo arma el almacenamiento.
func Nuevo(c Config) *Disco { return &Disco{carpeta: c.Carpeta, privada: c.CarpetaPrivada} }

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
// extensión de su tipo, en la carpeta pública: **cualquiera que tenga la URL
// lo baja**. Lo que es de alguien va con GuardarPrivado.
func (d *Disco) GuardarAdjunto(datos []byte, mime, prefijo string) (string, error) {
	nombre, err := nombreDeAdjunto(datos, mime, prefijo)
	if err != nil {
		return "", err
	}
	if err := d.escribir(nombre, datos); err != nil {
		return "", err
	}
	return "/subidas/" + nombre, nil
}

func nombreDeAdjunto(datos []byte, mime, prefijo string) (string, error) {
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
	return prefijo + "-" + uuid() + "." + ext, nil
}

// PrefijoPrivado es cómo empieza la referencia de un archivo privado en la
// base (`privado:<nombre>`, como los adjuntos de WhatsApp): nunca una URL,
// para que nadie la pueda pegar en el navegador.
const PrefijoPrivado = "privado:"

// GuardarPrivado guarda un adjunto en la carpeta privada, que Caddy no
// monta, y devuelve su referencia para la base. Los comprobantes de
// transferencia (con el CBU y el nombre de quien pagó) y los documentos
// técnicos van acá: antes iban a /subidas/, públicos para quien tuviera el
// enlace.
func (d *Disco) GuardarPrivado(datos []byte, mime, prefijo string) (string, error) {
	nombre, err := nombreDeAdjunto(datos, mime, prefijo)
	if err != nil {
		return "", err
	}
	if d.privada == "" {
		return "", errors.New("subidas: falta CARPETA_PRIVADA")
	}
	if err := os.MkdirAll(d.privada, 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(d.privada, nombre), datos, 0o640); err != nil {
		return "", err
	}
	return PrefijoPrivado + nombre, nil
}

// LeerGuardado lee un archivo por su referencia: `privado:<nombre>` de la
// carpeta privada, o `/subidas/<nombre>` de la pública (lo que se subió
// antes de que existiera la privada). Devuelve el tipo según la extensión;
// nil si no está o la referencia no es de acá.
func (d *Disco) LeerGuardado(ref string) ([]byte, string) {
	var ruta string
	switch {
	case strings.HasPrefix(ref, PrefijoPrivado) && d.privada != "":
		n := strings.TrimPrefix(ref, PrefijoPrivado)
		if !NombreValido(n) {
			return nil, ""
		}
		ruta = filepath.Join(d.privada, n)
	case strings.HasPrefix(ref, "/subidas/"):
		n := strings.TrimPrefix(ref, "/subidas/")
		if !NombreValido(n) {
			return nil, ""
		}
		ruta = filepath.Join(d.carpeta, n)
	default:
		return nil, ""
	}
	b, err := os.ReadFile(ruta)
	if err != nil {
		return nil, ""
	}
	return b, TipoDeNombre(ruta)
}

// TipoDeNombre es el tipo de un archivo guardado acá, por su extensión.
func TipoDeNombre(nombre string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(nombre), "."))
	for tipo, e := range extensionesDeAdjunto {
		if e == ext {
			return tipo
		}
	}
	if ext == "avif" {
		return "image/avif"
	}
	return "application/octet-stream"
}

// MoverAPrivado pasa un archivo de la carpeta pública a la privada y
// devuelve su nueva referencia. Si ya no está en la pública pero sí en la
// privada (una corrida anterior que se cortó), también vale: es repetible.
func (d *Disco) MoverAPrivado(url string) (string, error) {
	n := strings.TrimPrefix(url, "/subidas/")
	if !strings.HasPrefix(url, "/subidas/") || !NombreValido(n) {
		return "", &ErrSubida{"Nombre de archivo inválido."}
	}
	if d.privada == "" {
		return "", errors.New("subidas: falta CARPETA_PRIVADA")
	}
	if err := os.MkdirAll(d.privada, 0o755); err != nil {
		return "", err
	}
	origen, destino := filepath.Join(d.carpeta, n), filepath.Join(d.privada, n)
	datos, err := os.ReadFile(origen)
	if errors.Is(err, os.ErrNotExist) {
		if _, e := os.Stat(destino); e == nil {
			return PrefijoPrivado + n, nil
		}
		return "", err
	}
	if err != nil {
		return "", err
	}
	// Copiar y después borrar (no rename): las dos carpetas son volúmenes
	// distintos en el compose.
	if err := os.WriteFile(destino, datos, 0o640); err != nil {
		return "", err
	}
	if err := os.Remove(origen); err != nil {
		return "", err
	}
	return PrefijoPrivado + n, nil
}

var reNombre = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$`)

// NombreValido es nombreDeSubida: un nombre suelto, sin carpetas ni «..».
func NombreValido(nombre string) bool {
	return filepath.Base(nombre) == nombre && reNombre.MatchString(nombre) && !strings.Contains(nombre, "..")
}

// Borrar borra una foto por su URL (o un archivo privado por su
// referencia). Si ya no estaba, no es error.
func (d *Disco) Borrar(url string) error {
	if strings.HasPrefix(url, PrefijoPrivado) && d.privada != "" {
		nombre := strings.TrimPrefix(url, PrefijoPrivado)
		if !NombreValido(nombre) {
			return &ErrSubida{"Nombre de archivo inválido."}
		}
		err := os.Remove(filepath.Join(d.privada, nombre))
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
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

// Entregar escribe un archivo leído con LeerGuardado. `inline` para que el
// PDF o la foto se abran en el navegador, nosniff y un sandbox por si alguna
// vez entra algo que el navegador quiera interpretar.
func Entregar(w http.ResponseWriter, datos []byte, tipo, cache string) {
	w.Header().Set("Content-Type", tipo)
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("Cache-Control", cache)
	_, _ = w.Write(datos)
}
