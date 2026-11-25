package campanas

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"mjbj/internal/email"
	"mjbj/internal/jsmath"
	"mjbj/internal/zod"
)

// La lógica pura de las campañas (lib/campanas del TS): el cuerpo de texto a
// HTML, el enlace de baja firmado, el segmento y el correo de cada
// destinatario. El golden (testdata/golden/campanas) la compara con el TS.

/* ------------------------------- el cuerpo ------------------------------- */

// BloqueDeCuerpo es un párrafo o una lista.
type BloqueDeCuerpo struct {
	Tipo  string       `json:"tipo"`
	HTML  string       `json:"html,omitempty"`
	Texto string       `json:"texto,omitempty"`
	Items []EnLineaHTM `json:"items,omitempty"`
}

// EnLineaHTM es un renglón con su HTML y su texto.
type EnLineaHTM struct {
	HTML  string `json:"html"`
	Texto string `json:"texto"`
}

// `.` de JavaScript no cruza los finales de línea (\n, \r, U+2028, U+2029).
const puntoJS = `[^\n\r\x{2028}\x{2029}]`

var (
	reNegrita   = regexp.MustCompile(`\*\*(` + puntoJS + `+?)\*\*`)
	reEnlace    = regexp.MustCompile(`(https?://[^` + zod.ClaseEspacio + `<]+[^` + zod.ClaseEspacio + `<.,;:!?)])`)
	reBloques   = regexp.MustCompile(`\n[` + zod.ClaseEspacio + `]*\n`)
	reItem      = regexp.MustCompile(`^[-•][` + zod.ClaseEspacio + `]+`)
	reCorreoJS  = regexp.MustCompile(`^[^` + zod.ClaseEspacio + `@]+@[^` + zod.ClaseEspacio + `@]+\.[^` + zod.ClaseEspacio + `@]+$`)
	reEspaciosJ = regexp.MustCompile(`[` + zod.ClaseEspacio + `]+`)
)

func enLinea(crudo string) EnLineaHTM {
	h := email.Escapar(crudo)
	h = reNegrita.ReplaceAllString(h, "<strong>${1}</strong>")
	h = reEnlace.ReplaceAllString(h, `<a href="${1}" style="color:#B8541A;">${1}</a>`)
	return EnLineaHTM{HTML: h, Texto: reNegrita.ReplaceAllString(crudo, "${1}")}
}

// LeerCuerpo es leerCuerpo: párrafos separados por una línea en blanco, `- `
// arma una lista, `**así**` en negrita y las direcciones se vuelven enlaces.
func LeerCuerpo(cuerpo string) []BloqueDeCuerpo {
	out := []BloqueDeCuerpo{}
	for _, bloque := range reBloques.Split(strings.ReplaceAll(cuerpo, "\r\n", "\n"), -1) {
		bloque = zod.Trim(bloque)
		if bloque == "" {
			continue
		}
		lineas := strings.Split(bloque, "\n")
		todas := true
		for i, l := range lineas {
			lineas[i] = zod.Trim(l)
			if !reItem.MatchString(lineas[i]) {
				todas = false
			}
		}
		if todas {
			b := BloqueDeCuerpo{Tipo: "lista"}
			for _, l := range lineas {
				b.Items = append(b.Items, enLinea(reItem.ReplaceAllString(l, "")))
			}
			out = append(out, b)
			continue
		}
		var hs, ts []string
		for _, l := range lineas {
			p := enLinea(l)
			hs, ts = append(hs, p.HTML), append(ts, p.Texto)
		}
		out = append(out, BloqueDeCuerpo{Tipo: "parrafo", HTML: strings.Join(hs, "<br>"), Texto: strings.Join(ts, "\n")})
	}
	return out
}

// CuerpoComoParrafos son los bloques como párrafos HTML para Envolver.
func CuerpoComoParrafos(cuerpo string) []string {
	out := []string{}
	for _, b := range LeerCuerpo(cuerpo) {
		if b.Tipo == "parrafo" {
			out = append(out, b.HTML)
			continue
		}
		var s strings.Builder
		s.WriteString(`<ul style="margin:0;padding-left:20px;">`)
		for _, i := range b.Items {
			s.WriteString(`<li style="margin:0 0 6px;">` + i.HTML + `</li>`)
		}
		s.WriteString(`</ul>`)
		out = append(out, s.String())
	}
	return out
}

/* ------------------------------- la baja ------------------------------- */

// NormalizarCorreo es normalizarCorreo: sin espacios y en minúsculas.
func NormalizarCorreo(e string) string { return strings.ToLower(zod.Trim(e)) }

// firma es el HMAC de la dirección con el secreto (con un prefijo propio,
// para que la misma clave no firme dos cosas distintas), en base64url y
// cortado a 32.
func firma(correo, secreto string) string {
	m := hmac.New(sha256.New, []byte("bajas:"+secreto))
	m.Write([]byte(NormalizarCorreo(correo)))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))[:32]
}

// CodificarCorreo es la dirección en base64url.
func CodificarCorreo(correo string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(NormalizarCorreo(correo)))
}

// valor64 es el valor de un carácter en base64 o base64url (Node acepta los
// dos alfabetos), o -1.
func valor64(c byte) int {
	switch {
	case c >= 'A' && c <= 'Z':
		return int(c - 'A')
	case c >= 'a' && c <= 'z':
		return int(c-'a') + 26
	case c >= '0' && c <= '9':
		return int(c-'0') + 52
	case c == '+' || c == '-':
		return 62
	case c == '/' || c == '_':
		return 63
	}
	return -1
}

// base64Node es Buffer.from(s, "base64url") de Node: se saltea lo que no es
// del alfabeto y corta en el primer `=`.
func base64Node(s string) []byte {
	var vals []byte
	for i := 0; i < len(s); i++ {
		if s[i] == '=' {
			break
		}
		if v := valor64(s[i]); v >= 0 {
			vals = append(vals, byte(v))
		}
	}
	out := make([]byte, 0, len(vals)*3/4+2)
	for i := 0; i+1 < len(vals); i += 4 {
		out = append(out, vals[i]<<2|vals[i+1]>>4)
		if i+2 < len(vals) {
			out = append(out, vals[i+1]<<4|vals[i+2]>>2)
		}
		if i+3 < len(vals) {
			out = append(out, vals[i+2]<<6|vals[i+3])
		}
	}
	return out
}

// utf8Node es toString("utf8") de Node: lo inválido se reemplaza por U+FFFD
// una vez por «subparte maximal» (WHATWG), no una por byte.
func utf8Node(b []byte) string {
	var s strings.Builder
	for i := 0; i < len(b); {
		r, n := utf8.DecodeRune(b[i:])
		if r != utf8.RuneError || n > 1 {
			s.WriteRune(r)
			i += n
			continue
		}
		s.WriteRune(utf8.RuneError)
		i += subparte(b[i:])
	}
	return s.String()
}

// subparte es cuántos bytes ocupa el comienzo inválido de b (al menos 1):
// el prefijo más largo que todavía podía ser una secuencia válida.
func subparte(b []byte) int {
	c := b[0]
	var largo int
	lo, hi := byte(0x80), byte(0xBF)
	switch {
	case c >= 0xC2 && c <= 0xDF:
		largo = 2
	case c == 0xE0:
		largo, lo = 3, 0xA0
	case c >= 0xE1 && c <= 0xEC, c == 0xEE, c == 0xEF:
		largo = 3
	case c == 0xED:
		largo, hi = 3, 0x9F
	case c == 0xF0:
		largo, lo = 4, 0x90
	case c >= 0xF1 && c <= 0xF3:
		largo = 4
	case c == 0xF4:
		largo, hi = 4, 0x8F
	default:
		return 1
	}
	n := 1
	for n < largo && n < len(b) {
		x := b[n]
		if n == 1 {
			if x < lo || x > hi {
				break
			}
		} else if x < 0x80 || x > 0xBF {
			break
		}
		n++
	}
	return n
}

// DecodificarCorreo es decodificarCorreo: la dirección, si parece una.
func DecodificarCorreo(codificado string) (string, bool) {
	e := utf8Node(base64Node(codificado))
	if !reCorreoJS.MatchString(e) {
		return "", false
	}
	return e, true
}

// ParametrosDeBaja son los `e` y `t` del enlace.
func ParametrosDeBaja(correo, secreto string) (e, t string) {
	return CodificarCorreo(correo), firma(correo, secreto)
}

// VerificarBaja es la dirección, si el enlace es auténtico.
func VerificarBaja(e, t, secreto string) (string, bool) {
	correo, ok := DecodificarCorreo(e)
	if !ok || t == "" {
		return "", false
	}
	esperada := firma(correo, secreto)
	if len(esperada) != len(t) {
		return "", false
	}
	if subtle.ConstantTimeCompare([]byte(esperada), []byte(t)) != 1 {
		return "", false
	}
	return correo, true
}

/* ------------------------------- el segmento ------------------------------- */

// Actividad es el filtro por compras.
type Actividad struct {
	Tipo  string `json:"tipo"`
	Meses int    `json:"meses"`
}

// Segmento es SegmentoCampana: a quién va la campaña.
type Segmento struct {
	Tipo      string     `json:"tipo"`
	Rubros    []string   `json:"rubros"`
	Actividad *Actividad `json:"actividad"`
}

// Rubro es uno de RUBROS_CLIENTE (lib/rubros-cliente.ts).
type Rubro struct{ Valor, Etiqueta string }

// Rubros son los de lib/rubros-cliente.ts, en el mismo orden.
var Rubros = []Rubro{
	{"particular", "Particular"}, {"arquitecto", "Arquitectura"}, {"carpintero", "Carpintería"},
	{"cementista", "Cementista"}, {"constructora", "Constructora"}, {"woodframer", "Wood frame"},
	{"moldava", "Moldava"}, {"disenador", "Diseño de interiores"}, {"instalador", "Instalación y colocación"},
	{"otro", "Otro"},
}

// EsRubro dice si es uno de la lista.
func EsRubro(v string) bool {
	for _, r := range Rubros {
		if r.Valor == v {
			return true
		}
	}
	return false
}

func etiquetaDeRubro(v string) string {
	if v == "" {
		return "Sin rubro"
	}
	for _, r := range Rubros {
		if r.Valor == v {
			return r.Etiqueta
		}
	}
	return v
}

// DatosDeSegmento es lo que llega del formulario.
type DatosDeSegmento struct {
	Tipo      any   `json:"tipo"`
	Rubros    []any `json:"rubros"`
	Actividad any   `json:"actividad"`
	Meses     any   `json:"meses"`
}

func numeroJS(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		return x
	case string:
		return jsmath.Numero(x)
	case bool:
		if x {
			return 1
		}
		return 0
	}
	return math.NaN()
}

// LeerSegmento es leerSegmento: lo del formulario, sano.
func LeerSegmento(d DatosDeSegmento) Segmento {
	s := Segmento{Tipo: "todos", Rubros: []string{}}
	if t, _ := d.Tipo.(string); t == "particular" || t == "profesional" {
		s.Tipo = t
	}
	vistos := map[string]bool{}
	for _, r := range d.Rubros {
		v, _ := r.(string)
		if vistos[v] || !EsRubro(v) {
			continue
		}
		vistos[v] = true
		s.Rubros = append(s.Rubros, v)
	}
	meses := jsmath.Round(numeroJS(d.Meses))
	if a, _ := d.Actividad.(string); (a == "compraron" || a == "sinComprar") && !math.IsNaN(meses) && !math.IsInf(meses, 0) && meses >= 1 && meses <= 60 {
		s.Actividad = &Actividad{Tipo: a, Meses: int(meses)}
	}
	return s
}

// DescribirSegmento es el segmento en castellano.
func DescribirSegmento(s Segmento) string {
	quienes := "Todos los clientes"
	switch s.Tipo {
	case "profesional":
		quienes = "Profesionales"
	case "particular":
		quienes = "Particulares"
	}
	partes := []string{quienes}
	if len(s.Rubros) > 0 {
		var es []string
		for _, r := range s.Rubros {
			es = append(es, strings.ToLower(etiquetaDeRubro(r)))
		}
		partes = append(partes, "de "+strings.Join(es, ", "))
	}
	if s.Actividad != nil {
		meses := fmt.Sprintf("%d meses", s.Actividad.Meses)
		if s.Actividad.Meses == 1 {
			meses = "1 mes"
		}
		if s.Actividad.Tipo == "compraron" {
			partes = append(partes, "que compraron en los últimos "+meses)
		} else {
			partes = append(partes, "que no compran hace más de "+meses)
		}
	}
	return strings.Join(partes, " ") + " con correo"
}

// DuracionDelEnvio es cuánto tarda en salir, dicho como se dice.
func DuracionDelEnvio(cantidad, porMinuto int) string {
	minutos := max(1, int(math.Ceil(float64(cantidad)/float64(max(1, porMinuto)))))
	if minutos < 2 {
		return "un minuto"
	}
	if minutos < 60 {
		return fmt.Sprintf("unos %d minutos", minutos)
	}
	horas := jsmath.Round(float64(minutos)/6) / 10
	if horas < 24 {
		return "unas " + strings.Replace(jsmath.Texto(horas), ".", ",", 1) + " horas"
	}
	return fmt.Sprintf("unos %d días", int(math.Ceil(horas/24)))
}

/* ------------------------------- el correo ------------------------------- */

var titulos = map[string]bool{
	"arq": true, "ing": true, "lic": true, "dr": true, "dra": true, "sr": true, "sra": true, "srta": true, "cont": true,
	"tec": true, "téc": true, "prof": true, "mg": true, "esc": true, "cr": true, "cra": true,
}

// PrimerNombre es primerNombre de lib/formato: sin los títulos (Arq., Ing.).
func PrimerNombre(nombre string) string {
	var partes []string
	for _, p := range reEspaciosJ.Split(zod.Trim(nombre), -1) {
		if p != "" {
			partes = append(partes, p)
		}
	}
	if len(partes) == 0 {
		return ""
	}
	for _, p := range partes {
		if !titulos[strings.ToLower(strings.TrimSuffix(p, "."))] {
			return p
		}
	}
	return partes[0]
}

// ParaArmar es lo de la campaña que va en el correo.
type ParaArmar struct {
	Asunto     string  `json:"asunto"`
	Adelanto   *string `json:"adelanto"`
	Cuerpo     string  `json:"cuerpo"`
	ImagenURL  *string `json:"imagenUrl"`
	BotonTexto *string `json:"botonTexto"`
	BotonURL   *string `json:"botonUrl"`
}

// Correo es el mensaje armado para una persona.
type Correo struct {
	Asunto    string            `json:"asunto"`
	HTML      string            `json:"html"`
	Texto     string            `json:"texto"`
	Cabeceras map[string]string `json:"cabeceras"`
}

func val(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

var reAbsoluta = regexp.MustCompile(`^https?://`)

// ArmarCorreo es armarCorreoDeCampana: lleva el enlace de baja de esa
// persona y las cabeceras List-Unsubscribe (RFC 8058) que piden Gmail y
// Yahoo a quien manda correo masivo.
func ArmarCorreo(sitio, secreto string, c ParaArmar, para, nombre string) Correo {
	sitio = strings.TrimSuffix(sitio, "/")
	absoluta := func(u string) string {
		if reAbsoluta.MatchString(u) {
			return u
		}
		if strings.HasPrefix(u, "/") {
			return sitio + u
		}
		return sitio + "/" + u
	}
	e, t := ParametrosDeBaja(para, secreto)
	consulta := "e=" + e + "&t=" + t
	pagina := sitio + "/baja?" + consulta
	unClic := sitio + "/api/baja?" + consulta

	o := email.Opciones{
		Titulo:   c.Asunto,
		Adelanto: c.Asunto,
		Parrafos: CuerpoComoParrafos(c.Cuerpo),
		Pie: &email.Pie{
			HTML:  `Te escribimos porque sos cliente de la maderera. Si no querés recibir más novedades, <a href="` + pagina + `" style="color:#7A6F66;">date de baja acá</a>. Los avisos de tus pedidos te van a seguir llegando.`,
			Texto: "Si no querés recibir más novedades, date de baja en " + pagina,
		},
	}
	if a := val(c.Adelanto); a != "" {
		o.Adelanto = a
	}
	if nombre != "" {
		o.Saludo = PrimerNombre(nombre)
	}
	if i := val(c.ImagenURL); i != "" {
		o.Imagen = &email.Imagen{URL: absoluta(i), Alt: c.Asunto}
	}
	if bt, bu := val(c.BotonTexto), val(c.BotonURL); bt != "" && bu != "" {
		o.CTA = &email.Enlace{Texto: bt, URL: absoluta(bu)}
	}
	html, texto := email.Envolver(sitio, o)
	return Correo{
		Asunto: c.Asunto, HTML: html, Texto: texto,
		Cabeceras: map[string]string{
			"List-Unsubscribe":      "<" + unClic + ">",
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		},
	}
}
