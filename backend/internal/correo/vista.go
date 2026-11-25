package correo

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"mime/quotedprintable"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	"github.com/emersion/go-message/charset"
)

// La primera línea de cada fila de la lista («Dale, va el presupuesto…»).
//
// Se trae un pedazo del primer texto del mensaje y no el mensaje entero: con
// la estructura que ya vino en el FETCH de la lista se sabe qué parte es el
// texto, con qué codificación y en qué juego de caracteres, y se piden solo
// los primeros bytes de esa parte. Un correo de 10 MB con planos adjuntos
// cuesta lo mismo que uno de tres líneas.

const bytesVista = 2048
const largoVista = 160

type parteTexto struct {
	ruta       []int
	codificado string
	juego      string
	esHTML     bool
}

// textoDe busca la primera parte de texto que no es un adjunto: el texto
// plano si hay, si no el HTML.
func textoDe(bs imap.BodyStructure) (parteTexto, bool) {
	var plano, html *parteTexto
	if bs == nil {
		return parteTexto{}, false
	}
	bs.Walk(func(ruta []int, parte imap.BodyStructure) bool {
		sp, ok := parte.(*imap.BodyStructureSinglePart)
		if !ok || !strings.EqualFold(sp.Type, "text") {
			return true
		}
		if d := sp.Disposition(); d != nil && strings.EqualFold(d.Value, "attachment") {
			return true
		}
		p := &parteTexto{ruta: append([]int(nil), ruta...), codificado: strings.ToLower(sp.Encoding), juego: sp.Params["charset"]}
		// Un mensaje que no es multiparte tiene su único cuerpo en la parte 1.
		if len(p.ruta) == 0 {
			p.ruta = []int{1}
		}
		switch strings.ToLower(sp.Subtype) {
		case "plain":
			if plano == nil {
				plano = p
			}
		case "html":
			if html == nil {
				p.esHTML = true
				html = p
			}
		}
		return plano == nil
	})
	if plano != nil {
		return *plano, true
	}
	if html != nil {
		return *html, true
	}
	return parteTexto{}, false
}

// decodificarVista convierte el pedazo crudo en texto. Está cortado en
// cualquier lado, así que todo es tolerante: base64 hasta el último bloque
// entero, quoted-printable hasta donde se pueda leer.
func decodificarVista(p parteTexto, crudo []byte) string {
	var datos []byte
	switch p.codificado {
	case "base64":
		limpio := bytes.Map(func(r rune) rune {
			if r == '\r' || r == '\n' || r == ' ' || r == '\t' {
				return -1
			}
			return r
		}, crudo)
		limpio = limpio[:len(limpio)/4*4]
		datos = make([]byte, base64.StdEncoding.DecodedLen(len(limpio)))
		n, _ := base64.StdEncoding.Decode(datos, limpio)
		datos = datos[:n]
	case "quoted-printable":
		// Un «=" suelto al final (cortado a la mitad) haría fallar la lectura.
		if i := bytes.LastIndexByte(crudo, '='); i >= 0 && len(crudo)-i < 3 {
			crudo = crudo[:i]
		}
		datos, _ = io.ReadAll(quotedprintable.NewReader(bytes.NewReader(crudo)))
	default:
		datos = crudo
	}
	texto := string(datos)
	if p.juego != "" && !strings.EqualFold(p.juego, "utf-8") && !strings.EqualFold(p.juego, "us-ascii") {
		if r, err := charset.Reader(p.juego, bytes.NewReader(datos)); err == nil {
			if b, err := io.ReadAll(r); err == nil {
				texto = string(b)
			}
		}
	}
	if !utf8.ValidString(texto) {
		texto = strings.ToValidUTF8(texto, "")
	}
	if p.esHTML {
		texto = textoDeHTML(texto)
	}
	return resumirTexto(texto)
}

var (
	reEspacios = regexp.MustCompile(`\s+`)
	// «El vie, 24 oct 2026 a las 9:42, Martín escribió:» y sus parientes en
	// inglés: de ahí para abajo es la cita, no el mensaje.
	reEncabezadoCita = regexp.MustCompile(`(?i)^(el |on ).{0,200}(escribió|wrote):?\s*$`)
)

// resumirTexto se queda con lo que escribió la persona: sin las citas, sin
// la firma y en una sola línea.
func resumirTexto(t string) string {
	var partes []string
	for _, l := range strings.Split(strings.ReplaceAll(t, "\r\n", "\n"), "\n") {
		l = strings.TrimSpace(l)
		if l == "-- " || l == "--" || reEncabezadoCita.MatchString(l) || strings.HasPrefix(l, "---------- ") {
			break
		}
		if l == "" || strings.HasPrefix(l, ">") {
			continue
		}
		partes = append(partes, l)
		if len(partes) > 6 {
			break
		}
	}
	s := reEspacios.ReplaceAllString(strings.Join(partes, " "), " ")
	if utf8.RuneCountInString(s) > largoVista {
		r := []rune(s)
		s = strings.TrimSpace(string(r[:largoVista])) + "…"
	}
	return s
}

// agregarVistas completa `Vista` en los resúmenes. Los mensajes se agrupan
// por la ruta de su parte de texto (casi todos son «1» o «1.1») para pedir
// cada grupo en un solo FETCH. Si algo falla, la lista sale igual sin la
// primera línea: no vale la pena perder la bandeja por eso.
func (cx *conexion) agregarVistas(mensajes []*imapclient.FetchMessageBuffer, resumenes []Resumen) {
	type grupo struct {
		seccion *imap.FetchItemBodySection
		uids    []imap.UID
	}
	grupos := map[string]*grupo{}
	partes := map[imap.UID]parteTexto{}
	for _, m := range mensajes {
		p, ok := textoDe(m.BodyStructure)
		if !ok {
			continue
		}
		clave := fmt.Sprint(p.ruta)
		g := grupos[clave]
		if g == nil {
			g = &grupo{seccion: &imap.FetchItemBodySection{
				Part: p.ruta, Peek: true, Partial: &imap.SectionPartial{Offset: 0, Size: bytesVista},
			}}
			grupos[clave] = g
		}
		g.uids = append(g.uids, m.UID)
		partes[m.UID] = p
	}
	vistas := map[uint32]string{}
	for _, g := range grupos {
		res, err := cx.c.Fetch(imap.UIDSetNum(g.uids...), &imap.FetchOptions{
			UID: true, BodySection: []*imap.FetchItemBodySection{g.seccion},
		}).Collect()
		if err != nil {
			return
		}
		for _, m := range res {
			crudo := m.FindBodySection(g.seccion)
			if crudo == nil {
				continue
			}
			vistas[uint32(m.UID)] = decodificarVista(partes[m.UID], crudo)
		}
	}
	for i := range resumenes {
		resumenes[i].Vista = vistas[resumenes[i].UID]
	}
}
