package correo

import (
	"fmt"
	"net/url"
	"path"
	"regexp"
	"strings"

	"github.com/emersion/go-message/mail"
	"golang.org/x/net/html"
)

// El correo sospechoso (2d): un aviso arriba del mensaje cuando algo no
// cierra, los enlaces engañosos marcados y los programas adjuntos
// bloqueados. No es un antispam (eso lo hace el servidor de correo): es lo
// que se puede ver en el mensaje mismo y explicar en una línea.
//
// Las tres pistas:
//
//   - El servidor de correo no pudo comprobar el remitente (DMARC o SPF
//     fallidos en Authentication-Results) o lo marcó como spam.
//   - El nombre dice una marca conocida (Mercado Pago, un banco, ARCA) y la
//     dirección es de otro dominio: «Mercado Pago <avisos@mercadopag0.com>».
//   - Un enlace cuyo texto es una dirección y lleva a otra: el texto dice
//     www.mercadopago.com y el href va a mp-verificacion.xyz.

// Sospecha es por qué un mensaje parece una estafa.
type Sospecha struct {
	Motivo  string    `json:"motivo"`
	Enlaces []Enganio `json:"enlaces,omitempty"`
}

// Enganio es un enlace que dice ir a un lado y va a otro.
type Enganio struct {
	Texto   string `json:"texto"`
	Destino string `json:"destino"`
}

// Las extensiones de programas: un adjunto así no se deja bajar. Un
// comprobante, una factura o un plano nunca son un .exe.
var extensionesProgramas = map[string]bool{
	".exe": true, ".scr": true, ".com": true, ".bat": true, ".cmd": true, ".pif": true,
	".vbs": true, ".vbe": true, ".js": true, ".jse": true, ".wsf": true, ".wsh": true,
	".msi": true, ".msp": true, ".hta": true, ".cpl": true, ".jar": true, ".ps1": true,
	".lnk": true, ".reg": true, ".dll": true, ".iso": true, ".img": true, ".apk": true,
}

func esPrograma(nombre string) bool {
	return extensionesProgramas[strings.ToLower(path.Ext(strings.TrimSpace(nombre)))]
}

// Las marcas que más se usan para engañar en Argentina, con sus dominios
// de verdad. Un nombre que las menciona desde otro dominio es sospechoso.
var marcas = []struct {
	nombres  []string
	dominios []string
	mostrar  string
}{
	{[]string{"mercado pago", "mercadopago"}, []string{"mercadopago.com", "mercadopago.com.ar", "mercadolibre.com", "mercadolibre.com.ar"}, "Mercado Pago"},
	{[]string{"mercado libre", "mercadolibre"}, []string{"mercadolibre.com", "mercadolibre.com.ar", "mercadopago.com"}, "Mercado Libre"},
	{[]string{"banco provincia", "bapro"}, []string{"bancoprovincia.com.ar", "bapro.com.ar"}, "Banco Provincia"},
	{[]string{"banco nación", "banco nacion", "bna"}, []string{"bna.com.ar"}, "Banco Nación"},
	{[]string{"galicia"}, []string{"bancogalicia.com.ar", "galicia.ar"}, "Banco Galicia"},
	{[]string{"santander"}, []string{"santander.com.ar", "santander.com"}, "Santander"},
	{[]string{"bbva", "francés", "frances"}, []string{"bbva.com.ar", "bbva.com"}, "BBVA"},
	{[]string{"banco macro", "macro"}, []string{"macro.com.ar"}, "Banco Macro"},
	{[]string{"afip", "arca"}, []string{"afip.gob.ar", "arca.gob.ar"}, "ARCA"},
	{[]string{"paypal"}, []string{"paypal.com"}, "PayPal"},
}

func dominioDe(correo string) string {
	if i := strings.LastIndexByte(correo, '@'); i >= 0 {
		return strings.ToLower(correo[i+1:])
	}
	return ""
}

// esDe dice si el dominio es alguno de la lista o un subdominio.
func esDe(dominio string, lista []string) bool {
	for _, d := range lista {
		if dominio == d || strings.HasSuffix(dominio, "."+d) {
			return true
		}
	}
	return false
}

var (
	reAutenticacion = regexp.MustCompile(`(?i)\b(dmarc|spf)=(fail|softfail)\b`)
	reDominioTexto  = regexp.MustCompile(`(?i)^(https?://)?(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(/\S*)?$`)
)

// analizar junta las pistas. `html` es el cuerpo sin sanear (los enlaces se
// leen igual) y `adj` ya trae los programas marcados.
func analizar(h mail.Header, de []Direccion, cuerpo string, adj []Adjunto) *Sospecha {
	var motivos []string
	remitente := ""
	nombre := ""
	if len(de) > 0 {
		remitente = de[0].Correo
		nombre = strings.ToLower(de[0].Nombre)
	}
	dominio := dominioDe(remitente)

	for _, m := range marcas {
		for _, n := range m.nombres {
			if nombre != "" && strings.Contains(nombre, n) && dominio != "" && !esDe(dominio, m.dominios) {
				motivos = append(motivos, fmt.Sprintf("Dice venir de %s, pero lo manda %s.", m.mostrar, dominio))
				break
			}
		}
		if len(motivos) > 0 {
			break
		}
	}
	if len(motivos) == 0 {
		if r := h.Get("Authentication-Results"); r != "" && reAutenticacion.MatchString(r) {
			motivos = append(motivos, fmt.Sprintf("Dice venir de %s, pero no pudimos comprobarlo.", dominio))
		} else if strings.EqualFold(strings.TrimSpace(h.Get("X-Spam-Flag")), "yes") || strings.HasPrefix(strings.ToLower(h.Get("X-Spam")), "yes") {
			motivos = append(motivos, "El filtro del servidor lo marcó como correo basura.")
		}
	}

	enlaces := enlacesEnganosos(cuerpo)
	if len(enlaces) > 0 {
		motivos = append(motivos, "Tiene enlaces que dicen ir a un lado y llevan a otro.")
	}
	for _, a := range adj {
		if a.Bloqueado {
			motivos = append(motivos, fmt.Sprintf("Trae un programa adjunto (%s), que bloqueamos.", a.Nombre))
			break
		}
	}
	if len(motivos) == 0 {
		return nil
	}
	return &Sospecha{Motivo: strings.Join(motivos, " "), Enlaces: enlaces}
}

// hostDe saca el dominio de lo que parece una dirección, con o sin
// esquema, y sin el «www.».
func hostDe(s string) string {
	s = strings.TrimSpace(s)
	if !strings.Contains(s, "://") {
		s = "http://" + s
	}
	u, err := url.Parse(s)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
}

// enlacesEnganosos recorre los <a> del HTML: si el texto es una dirección
// y el href va a otro dominio, es un engaño. Un «Hacé clic acá» no cuenta:
// no promete ningún destino.
func enlacesEnganosos(cuerpo string) []Enganio {
	if cuerpo == "" {
		return nil
	}
	var out []Enganio
	z := html.NewTokenizer(strings.NewReader(cuerpo))
	var href string
	var texto strings.Builder
	dentro := false
	for {
		switch z.Next() {
		case html.ErrorToken:
			return out
		case html.StartTagToken:
			t := z.Token()
			if t.Data == "a" {
				dentro, href = true, ""
				texto.Reset()
				for _, a := range t.Attr {
					if a.Key == "href" {
						href = a.Val
					}
				}
			}
		case html.TextToken:
			if dentro {
				texto.Write(z.Text())
			}
		case html.EndTagToken:
			if t := z.Token(); t.Data == "a" && dentro {
				dentro = false
				if e, ok := engania(texto.String(), href); ok {
					out = append(out, e)
				}
			}
		}
	}
}

func engania(texto, href string) (Enganio, bool) {
	texto = strings.TrimSpace(texto)
	if !reDominioTexto.MatchString(texto) || !strings.HasPrefix(strings.ToLower(href), "http") {
		return Enganio{}, false
	}
	dice, va := hostDe(texto), hostDe(href)
	if dice == "" || va == "" || dice == va || strings.HasSuffix(va, "."+dice) {
		return Enganio{}, false
	}
	return Enganio{Texto: dice, Destino: va}, true
}

// marcarEnganosos agrega a cada enlace engañoso del HTML ya saneado un
// atributo con la explicación, que la hoja de estilos del iframe muestra al
// pasar el mouse (sin scripts: el iframe no los corre).
func marcarEnganosos(saneado string) string {
	var b strings.Builder
	z := html.NewTokenizer(strings.NewReader(saneado))
	// Se juntan los tokens de cada <a> para decidir con su texto completo.
	var abierto *html.Token
	var adentro []html.Token
	escribir := func(t html.Token) { b.WriteString(t.String()) }
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			if abierto != nil {
				escribir(*abierto)
				for _, t := range adentro {
					escribir(t)
				}
			}
			return b.String()
		}
		t := z.Token()
		switch {
		case tt == html.StartTagToken && t.Data == "a" && abierto == nil:
			abierto, adentro = &t, nil
		case abierto != nil && tt == html.EndTagToken && t.Data == "a":
			var texto strings.Builder
			for _, x := range adentro {
				if x.Type == html.TextToken {
					texto.WriteString(x.Data)
				}
			}
			href := ""
			for _, a := range abierto.Attr {
				if a.Key == "href" {
					href = a.Val
				}
			}
			if e, ok := engania(texto.String(), href); ok {
				abierto.Attr = append(abierto.Attr, html.Attribute{
					Key: "data-enganoso", Val: fmt.Sprintf("Este enlace no va a %s: lleva a %s", e.Texto, e.Destino),
				})
			}
			escribir(*abierto)
			for _, x := range adentro {
				escribir(x)
			}
			escribir(t)
			abierto, adentro = nil, nil
		case abierto != nil:
			adentro = append(adentro, t)
		default:
			escribir(t)
		}
	}
}
