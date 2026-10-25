package correo

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"regexp"
	"strings"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-message"
	"github.com/emersion/go-message/charset"
	"github.com/emersion/go-message/mail"
	"github.com/microcosm-cc/bluemonday"
)

func init() {
	// go-message decodifica Latin-1, Windows-1252 y compañía solo si se le
	// registra el lector de charsets; sin esto, los correos viejos de
	// Outlook llegan con «Ã±» en vez de «ñ».
	message.CharsetReader = charset.Reader
}

// Adjunto es un archivo del mensaje. `Indice` es su número de orden entre
// las partes que no son el texto, y es lo que se pide para bajarlo.
type Adjunto struct {
	Indice  int    `json:"indice"`
	Nombre  string `json:"nombre"`
	Tipo    string `json:"tipo"`
	Tamano  int    `json:"tamano"`
	EnLinea bool   `json:"enLinea"` // una imagen dentro del cuerpo (cid:)
	// Bloqueado es un programa (.exe, .scr…): no se deja bajar (sospecha.go).
	Bloqueado bool `json:"bloqueado,omitempty"`
	cid       string
}

// Mensaje es un mensaje abierto.
type Mensaje struct {
	Resumen
	CC          []Direccion `json:"cc"`
	ResponderA  []Direccion `json:"responderA"`
	MessageID   string      `json:"messageId,omitempty"`
	Referencias []string    `json:"referencias,omitempty"`
	Texto       string      `json:"texto"`
	TieneHTML   bool        `json:"tieneHtml"`
	// ImagenesRemotas avisa que el HTML pide imágenes de afuera, que no se
	// cargan hasta que la persona lo permite: una imagen remota avisa al que
	// mandó el correo que se abrió, y desde dónde.
	ImagenesRemotas bool      `json:"imagenesRemotas"`
	Adjuntos        []Adjunto `json:"adjuntos"`
	// Sospecha es por qué parece una estafa; nil si no hay nada raro.
	Sospecha *Sospecha `json:"sospecha,omitempty"`
	html     string
}

// tope de lo que se procesa de un mensaje: más de esto no es un correo, es
// un problema (docker-mailserver rechaza arriba de 25 MB igual).
const topeMensaje = 40 << 20

func parsear(crudo []byte) (*Mensaje, [][]byte, error) {
	lector, err := mail.CreateReader(bytes.NewReader(crudo))
	if err != nil && !message.IsUnknownCharset(err) && !message.IsUnknownEncoding(err) {
		return nil, nil, fmt.Errorf("leyendo el mensaje: %w", err)
	}
	m := &Mensaje{Adjuntos: []Adjunto{}}
	h := lector.Header
	m.Asunto, _ = h.Subject()
	m.Fecha, _ = h.Date()
	m.De = desdeMail(h, "From")
	m.Para = desdeMail(h, "To")
	m.CC = desdeMail(h, "Cc")
	m.ResponderA = desdeMail(h, "Reply-To")
	m.MessageID, _ = h.MessageID()
	m.Referencias, _ = h.MsgIDList("References")

	var datos [][]byte
	var texto, html strings.Builder
	for {
		parte, err := lector.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			if message.IsUnknownCharset(err) || message.IsUnknownEncoding(err) {
				continue
			}
			return nil, nil, fmt.Errorf("leyendo una parte: %w", err)
		}
		cuerpo, err := io.ReadAll(io.LimitReader(parte.Body, topeMensaje))
		if err != nil {
			return nil, nil, fmt.Errorf("leyendo una parte: %w", err)
		}
		switch ph := parte.Header.(type) {
		case *mail.InlineHeader:
			tipo, _, _ := ph.ContentType()
			cid := strings.Trim(ph.Get("Content-Id"), "<> ")
			switch {
			case tipo == "text/plain" && cid == "":
				if texto.Len() > 0 {
					texto.WriteString("\n\n")
				}
				texto.Write(cuerpo)
			case tipo == "text/html" && cid == "":
				html.Write(cuerpo)
			default:
				m.Adjuntos = append(m.Adjuntos, Adjunto{
					Indice: len(datos), Nombre: nombreDeParte(ph.Header, tipo, len(datos)),
					Tipo: tipo, Tamano: len(cuerpo), EnLinea: cid != "", cid: cid,
				})
				datos = append(datos, cuerpo)
			}
		case *mail.AttachmentHeader:
			tipo, _, _ := ph.ContentType()
			nombre, _ := ph.Filename()
			if nombre == "" {
				nombre = nombreDeParte(ph.Header, tipo, len(datos))
			}
			m.Adjuntos = append(m.Adjuntos, Adjunto{
				Indice: len(datos), Nombre: nombre, Tipo: tipo, Tamano: len(cuerpo),
				cid: strings.Trim(ph.Get("Content-Id"), "<> "),
			})
			datos = append(datos, cuerpo)
		}
	}
	m.Texto = strings.TrimSpace(strings.ReplaceAll(texto.String(), "\r\n", "\n"))
	m.html = html.String()
	for i := range m.Adjuntos {
		m.Adjuntos[i].Bloqueado = esPrograma(m.Adjuntos[i].Nombre)
	}
	m.Sospecha = analizar(h, m.De, m.html, m.Adjuntos)
	m.TieneHTML = strings.TrimSpace(m.html) != ""
	m.ImagenesRemotas = m.TieneHTML && reRemoto.MatchString(m.html)
	if m.Texto == "" && m.TieneHTML {
		m.Texto = textoDeHTML(m.html)
	}
	return m, datos, nil
}

func nombreDeParte(h message.Header, tipo string, i int) string {
	if _, p, err := h.ContentType(); err == nil && p["name"] != "" {
		return p["name"]
	}
	ext := ""
	if exts, _ := mime.ExtensionsByType(tipo); len(exts) > 0 {
		ext = exts[0]
	}
	return fmt.Sprintf("adjunto-%d%s", i+1, ext)
}

func desdeMail(h mail.Header, campo string) []Direccion {
	lista, err := h.AddressList(campo)
	if err != nil {
		return []Direccion{}
	}
	out := make([]Direccion, 0, len(lista))
	for _, a := range lista {
		out = append(out, Direccion{Nombre: a.Name, Correo: strings.ToLower(a.Address)})
	}
	return out
}

// Abrir trae y desarma el mensaje, y lo marca leído.
func (s *Servidor) Abrir(ctx context.Context, cred Credenciales, carpeta string, uid uint32) (*Mensaje, error) {
	cx, err := s.conectar(ctx, cred)
	if err != nil {
		return nil, err
	}
	defer cx.cerrar()
	crudo, flags, err := cx.crudo(carpeta, uid, true)
	if err != nil {
		return nil, err
	}
	m, _, err := parsear(crudo)
	if err != nil {
		return nil, err
	}
	m.UID = uid
	m.Tamano = int64(len(crudo))
	m.Leido = true
	for _, f := range flags {
		switch f {
		case imap.FlagFlagged:
			m.Destacado = true
		case imap.FlagAnswered:
			m.Respondido = true
		}
	}
	m.Adjuntos = soloVisibles(m.Adjuntos, m.html)
	if m.Fecha.IsZero() {
		m.Fecha = time.Now()
	}
	return m, nil
}

// soloVisibles saca de la lista las imágenes en línea que el HTML usa: ya se
// ven en el cuerpo, y listarlas como adjuntos confunde («¿qué es este
// image001.png?»). Las que el HTML no nombra sí se listan.
func soloVisibles(adj []Adjunto, html string) []Adjunto {
	out := make([]Adjunto, 0, len(adj))
	for _, a := range adj {
		if a.cid != "" && strings.Contains(html, "cid:"+a.cid) {
			continue
		}
		out = append(out, a)
	}
	return out
}

// Parte es un adjunto para bajar.
type Parte struct {
	Nombre string
	Tipo   string
	Datos  []byte
}

// Adjunto devuelve el adjunto número `indice`, o la imagen en línea con ese
// Content-ID si `cid` no está vacío.
func (s *Servidor) Adjunto(ctx context.Context, cred Credenciales, carpeta string, uid uint32, indice int, cid string) (*Parte, error) {
	cx, err := s.conectar(ctx, cred)
	if err != nil {
		return nil, err
	}
	defer cx.cerrar()
	crudo, _, err := cx.crudo(carpeta, uid, false)
	if err != nil {
		return nil, err
	}
	m, datos, err := parsear(crudo)
	if err != nil {
		return nil, err
	}
	for _, a := range m.Adjuntos {
		if (cid != "" && a.cid == cid) || (cid == "" && a.Indice == indice) {
			if a.Bloqueado {
				return nil, ErrBloqueado
			}
			return &Parte{Nombre: a.Nombre, Tipo: a.Tipo, Datos: datos[a.Indice]}, nil
		}
	}
	return nil, ErrNoExiste
}

// Varios devuelve los adjuntos pedidos por índice, en el orden del
// mensaje, para bajarlos juntos. Los programas bloqueados se saltean.
func (s *Servidor) Varios(ctx context.Context, cred Credenciales, carpeta string, uid uint32, indices []int) ([]Parte, error) {
	cx, err := s.conectar(ctx, cred)
	if err != nil {
		return nil, err
	}
	defer cx.cerrar()
	crudo, _, err := cx.crudo(carpeta, uid, false)
	if err != nil {
		return nil, err
	}
	m, datos, err := parsear(crudo)
	if err != nil {
		return nil, err
	}
	pedidos := map[int]bool{}
	for _, i := range indices {
		pedidos[i] = true
	}
	var out []Parte
	for _, a := range m.Adjuntos {
		if pedidos[a.Indice] && !a.Bloqueado {
			out = append(out, Parte{Nombre: a.Nombre, Tipo: a.Tipo, Datos: datos[a.Indice]})
		}
	}
	if len(out) == 0 {
		return nil, ErrNoExiste
	}
	return out, nil
}

// HTML devuelve el cuerpo HTML ya saneado, con las imágenes en línea
// incrustadas.
//
// Van incrustadas (data:) y no por una ruta propia porque el HTML se muestra
// en un iframe aislado, con origen opaco: desde ahí el navegador no manda la
// cookie de la sesión, y una ruta que la pide no se podría cargar.
func (s *Servidor) HTML(ctx context.Context, cred Credenciales, carpeta string, uid uint32) (string, error) {
	cx, err := s.conectar(ctx, cred)
	if err != nil {
		return "", err
	}
	defer cx.cerrar()
	crudo, _, err := cx.crudo(carpeta, uid, false)
	if err != nil {
		return "", err
	}
	m, datos, err := parsear(crudo)
	if err != nil {
		return "", err
	}
	enLinea := map[string]string{}
	for _, a := range m.Adjuntos {
		if a.cid != "" && strings.HasPrefix(a.Tipo, "image/") {
			enLinea[a.cid] = "data:" + a.Tipo + ";base64," + base64.StdEncoding.EncodeToString(datos[a.Indice])
		}
	}
	return sanear(m.html, enLinea), nil
}

var (
	reRemoto = regexp.MustCompile(`(?i)(src|background)\s*=\s*["']?\s*(https?:)?//|url\(\s*["']?\s*(https?:)?//`)
	reCID    = regexp.MustCompile(`(?i)\bcid:([^"'\s)>]+)`)
)

// politica es la de bluemonday para contenido de usuarios, más lo que un
// correo necesita para verse como lo armó quien lo mandó: tablas, estilos en
// línea, colores. Lo peligroso (scripts, formularios, iframes, eventos) se va
// igual. El HTML además se muestra en un iframe aislado con su propia CSP
// (ver http.go), que es la que de verdad frena las imágenes remotas.
var politica = func() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()
	p.AllowAttrs("style").Globally()
	p.AllowAttrs("align", "valign", "bgcolor", "color", "width", "height", "border", "cellpadding", "cellspacing").Globally()
	p.AllowElements("center", "font", "span", "div", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "style")
	p.AllowAttrs("face", "size").OnElements("font")
	p.AllowURLSchemes("http", "https", "mailto", "tel", "cid")
	p.RequireNoReferrerOnLinks(true)
	p.AddTargetBlankToFullyQualifiedLinks(true)
	p.AllowImages()
	p.AllowDataURIImages()
	return p
}()

func sanear(html string, enLinea map[string]string) string {
	// Primero se reemplazan los cid: (bluemonday deja pasar data: solo en
	// imágenes, que es justo donde van) y después se sanea todo junto.
	conImagenes := reCID.ReplaceAllStringFunc(html, func(s string) string {
		if datos, ok := enLinea[reCID.FindStringSubmatch(s)[1]]; ok {
			return datos
		}
		return s
	})
	return marcarEnganosos(politica.Sanitize(conImagenes))
}

var reEtiquetas = regexp.MustCompile(`(?s)<style.*?</style>|<script.*?</script>|<[^>]+>`)

// textoDeHTML es una versión en texto de un correo que solo trae HTML: para
// la vista previa y para citar al responder.
func textoDeHTML(h string) string {
	h = regexp.MustCompile(`(?i)<br\s*/?>|</p>|</div>|</tr>`).ReplaceAllString(h, "\n")
	t := reEtiquetas.ReplaceAllString(h, "")
	t = strings.NewReplacer("&nbsp;", " ", "&amp;", "&", "&lt;", "<", "&gt;", ">", "&quot;", `"`, "&#39;", "'").Replace(t)
	lineas := strings.Split(t, "\n")
	var out []string
	vacias := 0
	for _, l := range lineas {
		l = strings.TrimSpace(l)
		if l == "" {
			vacias++
			if vacias > 1 {
				continue
			}
		} else {
			vacias = 0
		}
		out = append(out, l)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}
