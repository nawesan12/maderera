package whatsapp

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"

	"mjbj/internal/jsmath"
)

// Las plantillas de WhatsApp (lib/whatsapp/plantillas.ts): leer lo que
// devuelve Meta y armar lo que hay que mandarle. Al enviar se mandan solo
// los valores; el texto lo arma Meta con lo que aprobó. Por eso la vista
// previa sale de los mismos componentes.

// Campo es un dato a completar antes de mandar la plantilla.
type Campo struct {
	Clave       string  `json:"clave"`
	Donde       string  `json:"donde"`
	Marcador    string  `json:"marcador"`
	Ejemplo     *string `json:"ejemplo"`
	Media       string  `json:"media,omitempty"`
	IndiceBoton *int    `json:"indiceBoton,omitempty"`
}

// Boton es un botón de la plantilla.
type Boton struct {
	Tipo  string `json:"tipo"`
	Texto string `json:"texto"`
}

// Plantilla es una plantilla leída.
type Plantilla struct {
	Nombre          string  `json:"nombre"`
	Idioma          string  `json:"idioma"`
	Categoria       *string `json:"categoria"`
	Estado          string  `json:"estado"`
	Formato         string  `json:"formato"`
	Encabezado      *string `json:"encabezado"`
	EncabezadoMedia *string `json:"encabezadoMedia"`
	Cuerpo          string  `json:"cuerpo"`
	Pie             *string `json:"pie"`
	Botones         []Boton `json:"botones"`
	Campos          []Campo `json:"campos"`
}

var reMarcador = regexp.MustCompile(`\{\{[` + claseEspacioJS + `]*([a-zA-Z0-9_]+)[` + claseEspacioJS + `]*\}\}`)

// Marcadores son los de un texto, sin repetir y en orden.
func Marcadores(texto string) []string {
	vistos := []string{}
	for _, m := range reMarcador.FindAllStringSubmatch(texto, -1) {
		if !contiene(vistos, m[1]) {
			vistos = append(vistos, m[1])
		}
	}
	return vistos
}

func contiene(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

type obj = map[string]any

func comoObj(v any) obj {
	o, _ := v.(map[string]any)
	return o
}

func comoLista(v any) []any {
	l, _ := v.([]any)
	return l
}

func textoDe(v any) string {
	s, _ := v.(string)
	return s
}

func punteroTexto(v any) *string {
	if s, ok := v.(string); ok {
		return &s
	}
	return nil
}

func ptr[T any](v T) *T { return &v }

// LeerPlantilla lee los componentes de Meta y arma la lista de datos a completar.
func LeerPlantilla(nombre, idioma string, categoria, estado, formatoParam *string, componentes json.RawMessage) Plantilla {
	var lista []any
	_ = json.Unmarshal(componentes, &lista)
	return leerPlantilla(nombre, idioma, categoria, estado, formatoParam, lista)
}

func leerPlantilla(nombre, idioma string, categoria, estado, formatoParam *string, lista []any) Plantilla {
	comps := []obj{}
	for _, c := range lista {
		comps = append(comps, comoObj(c))
	}
	formatoP := "POSITIONAL"
	if formatoParam != nil && mayusculasJS(*formatoParam) == "NAMED" {
		formatoP = "NAMED"
	}
	buscar := func(tipo string) obj {
		for _, c := range comps {
			if mayusculasJS(textoDe(c["type"])) == tipo {
				if c == nil {
					return obj{}
				}
				return c
			}
		}
		return nil
	}
	header, body, footer, buttons := buscar("HEADER"), buscar("BODY"), buscar("FOOTER"), buscar("BUTTONS")

	campos := []Campo{}
	var encabezado, encabezadoMedia *string
	if header != nil {
		fh := mayusculasJS(textoDe(header["format"]))
		if fh == "" {
			fh = "TEXT"
		}
		ejemplo := comoObj(header["example"])
		switch fh {
		case "TEXT":
			encabezado = punteroTexto(header["text"])
			nombrados := comoLista(ejemplo["header_text_named_params"])
			for i, m := range Marcadores(textoDe(header["text"])) {
				campos = append(campos, Campo{Clave: "encabezado:" + m, Donde: "encabezado", Marcador: m,
					Ejemplo: ejemploDe(nombrados, m, comoLista(ejemplo["header_text"]), i)})
			}
		case "DOCUMENT", "IMAGE", "VIDEO":
			t := strings.ToLower(fh)
			encabezadoMedia = &t
			campos = append(campos, Campo{Clave: "encabezado:media", Donde: "encabezado", Marcador: "media", Media: t})
		}
	}

	cuerpo := textoDe(body["text"])
	ejCuerpo := comoObj(body["example"])
	nombradosCuerpo := comoLista(ejCuerpo["body_text_named_params"])
	primeraFila := comoLista(firstOf(comoLista(ejCuerpo["body_text"])))
	for i, m := range Marcadores(cuerpo) {
		campos = append(campos, Campo{Clave: "cuerpo:" + m, Donde: "cuerpo", Marcador: m,
			Ejemplo: ejemploDe(nombradosCuerpo, m, primeraFila, i)})
	}

	botones := []Boton{}
	reUno := regexp.MustCompile(`\{\{[` + claseEspacioJS + `]*1[` + claseEspacioJS + `]*\}\}`)
	for i, b := range comoLista(buttons["buttons"]) {
		bo := comoObj(b)
		tipo := mayusculasJS(textoDe(bo["type"]))
		if url := textoDe(bo["url"]); tipo == "URL" && url != "" && reUno.MatchString(url) {
			campos = append(campos, Campo{Clave: "boton:" + strconv.Itoa(i), Donde: "boton", Marcador: "1",
				Ejemplo: punteroTexto(firstOf(comoLista(bo["example"]))), IndiceBoton: ptr(i)})
		}
		botones = append(botones, Boton{tipo, textoDe(bo["text"])})
	}

	var cat *string
	if categoria != nil && *categoria != "" {
		cat = ptr(mayusculasJS(*categoria))
	}
	est := "APPROVED"
	if estado != nil {
		est = *estado
	}
	return Plantilla{
		Nombre: nombre, Idioma: idioma, Categoria: cat, Estado: mayusculasJS(est), Formato: formatoP,
		Encabezado: encabezado, EncabezadoMedia: encabezadoMedia, Cuerpo: cuerpo, Pie: punteroTexto(footer["text"]),
		Botones: botones, Campos: campos,
	}
}

func firstOf(l []any) any {
	if len(l) == 0 {
		return nil
	}
	return l[0]
}

func ejemploDe(nombrados []any, marcador string, posicionales []any, i int) *string {
	for _, e := range nombrados {
		eo := comoObj(e)
		if pn, ok := eo["param_name"]; ok && pn == marcador {
			// El primero que coincide; sin ejemplo, se sigue con el posicional.
			if s := punteroTexto(eo["example"]); s != nil {
				return s
			}
			break
		}
	}
	if i < len(posicionales) {
		return punteroTexto(posicionales[i])
	}
	return nil
}

// Completar reemplaza los marcadores por los valores; uno sin valor queda a la vista.
func Completar(texto string, valores map[string]string) string {
	return reMarcador.ReplaceAllStringFunc(texto, func(entero string) string {
		m := reMarcador.FindStringSubmatch(entero)[1]
		if v, ok := valores[m]; ok && trimJS(v) != "" {
			return v
		}
		return entero
	})
}

// VistaPrevia es el texto que va a leer el cliente, con encabezado y pie.
func VistaPrevia(p Plantilla, valores map[string]string) string {
	de := func(donde string) map[string]string {
		out := map[string]string{}
		for _, c := range p.Campos {
			if c.Donde == donde {
				out[c.Marcador] = valores[c.Clave]
			}
		}
		return out
	}
	partes := []string{}
	if p.Encabezado != nil && *p.Encabezado != "" {
		if e := Completar(*p.Encabezado, de("encabezado")); e != "" {
			partes = append(partes, e)
		}
	}
	if c := Completar(p.Cuerpo, de("cuerpo")); c != "" {
		partes = append(partes, c)
	}
	if p.Pie != nil && *p.Pie != "" {
		partes = append(partes, *p.Pie)
	}
	return strings.Join(partes, "\n\n")
}

// CamposFaltantes son los datos sin completar (el archivo del encabezado no se cuenta).
func CamposFaltantes(p Plantilla, valores map[string]string) []Campo {
	out := []Campo{}
	for _, c := range p.Campos {
		if c.Marcador != "media" && trimJS(valores[c.Clave]) == "" {
			out = append(out, c)
		}
	}
	return out
}

var (
	reSaltos   = regexp.MustCompile(`[\r\n\t]+`)
	reEspacios = regexp.MustCompile(` {4,}`)
)

// ValorParaMeta es un valor como lo acepta Meta: sin saltos ni tabulaciones,
// sin más de tres espacios seguidos (si no, 132018) y de largo razonable.
func ValorParaMeta(v string) string {
	v = reSaltos.ReplaceAllString(v, " ")
	v = reEspacios.ReplaceAllString(v, "   ")
	return cortarJS(trimJS(v), 1000)
}

// MediaEncabezado es el archivo del encabezado: ya subido (ID) o por enlace.
type MediaEncabezado struct {
	ID     string
	Link   string
	Nombre string
}

// ArmarComponentes son los `components` del envío, como los pide la Cloud API.
func ArmarComponentes(p Plantilla, valores map[string]string, media *MediaEncabezado) []obj {
	comps := []obj{}
	conNombre := p.Formato == "NAMED"
	parametro := func(c Campo) obj {
		o := obj{"type": "text"}
		if conNombre {
			o["parameter_name"] = c.Marcador
		}
		o["text"] = ValorParaMeta(valores[c.Clave])
		return o
	}
	var deEncabezado, deCuerpo, deBoton []Campo
	for _, c := range p.Campos {
		switch c.Donde {
		case "encabezado":
			deEncabezado = append(deEncabezado, c)
		case "cuerpo":
			deCuerpo = append(deCuerpo, c)
		case "boton":
			deBoton = append(deBoton, c)
		}
	}
	if p.EncabezadoMedia != nil && *p.EncabezadoMedia != "" && media != nil {
		tipo := *p.EncabezadoMedia
		o := obj{}
		if media.ID != "" {
			o["id"] = media.ID
		} else {
			o["link"] = media.Link
		}
		if tipo == "document" && media.Nombre != "" {
			o["filename"] = media.Nombre
		}
		comps = append(comps, obj{"type": "header", "parameters": []any{obj{"type": tipo, tipo: o}}})
	} else if len(deEncabezado) > 0 && (p.EncabezadoMedia == nil || *p.EncabezadoMedia == "") {
		ps := []any{}
		for _, c := range deEncabezado {
			ps = append(ps, parametro(c))
		}
		comps = append(comps, obj{"type": "header", "parameters": ps})
	}
	if len(deCuerpo) > 0 {
		ps := []any{}
		for _, c := range deCuerpo {
			ps = append(ps, parametro(c))
		}
		comps = append(comps, obj{"type": "body", "parameters": ps})
	}
	for _, c := range deBoton {
		indice := 0
		if c.IndiceBoton != nil {
			indice = *c.IndiceBoton
		}
		comps = append(comps, obj{"type": "button", "sub_type": "url", "index": strconv.Itoa(indice),
			"parameters": []any{obj{"type": "text", "text": ValorParaMeta(valores[c.Clave])}}})
	}
	return comps
}

// OrdenPosicional es el orden de siempre de las plantillas posicionales.
var OrdenPosicional = []string{"nombre", "pedido", "sucursal"}

// SugerirValores completa los campos con lo que ya se sabe.
func SugerirValores(p Plantilla, conocidos map[string]string, orden []string) map[string]string {
	if orden == nil {
		orden = OrdenPosicional
	}
	valores := map[string]string{}
	for _, c := range p.Campos {
		if c.Marcador == "media" {
			continue
		}
		if c.Donde == "boton" {
			if b := conocidos["boton"]; b != "" {
				valores[c.Clave] = b
			}
			continue
		}
		if v, ok := conocidos[c.Marcador]; ok {
			valores[c.Clave] = v
			continue
		}
		pos := jsmath.Numero(c.Marcador)
		if !math.IsNaN(pos) && pos == math.Trunc(pos) && pos > 0 && pos <= float64(len(orden)) {
			if v, ok := conocidos[orden[int(pos)-1]]; ok {
				valores[c.Clave] = v
			}
		}
	}
	return valores
}

// NombreLegible es «pedido_listo» → «Pedido listo».
func NombreLegible(nombre string) string {
	t := trimJS(strings.ReplaceAll(nombre, "_", " "))
	if t == "" {
		return ""
	}
	for i := range t {
		if i > 0 {
			return mayusculasJS(t[:i]) + t[i:]
		}
	}
	return mayusculasJS(t)
}
