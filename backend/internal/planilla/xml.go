package planilla

import (
	"errors"
	"fmt"
	"math"
	"unicode/utf16"
)

// Lo que el TS lee del .xlsx sale de fast-xml-parser 5 con estas opciones:
// `ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false,
// parseAttributeValue: false` (y lo demás por omisión: recorta los textos,
// resuelve solo las cinco entidades de XML, deja `&#NN;` como está, no mira
// los espacios de nombres y no valida). Ese parser es permisivo de una forma
// muy suya —ignora el nombre de la etiqueta que cierra, no se queja de una
// etiqueta sin cerrar al final, junta los hermanos repetidos en un arreglo—,
// y encoding/xml no se le parece: rechaza lo que él acepta, resuelve lo que él
// deja y conserva lo que él recorta. Para que la grilla sea la misma, acá se
// reproduce su algoritmo, sobre unidades UTF-16 como un string de JS (los
// índices de los mensajes de error y la ventana de 32 de las entidades se
// cuentan así).
//
// El resultado es el mismo objeto que arma el TS: un *objeto (las claves en
// orden), un string o un []valor; nil es undefined.

type valor = any

// objeto guarda las claves en orden en un slice y las busca recorriéndolo:
// un nodo tiene pocas (una celda: r, s, t, v), y un map por nodo era la mitad
// del tiempo y de la memoria con una hoja de 20.000 filas.
type objeto struct {
	pares []par
}

type par struct {
	k string
	v valor
}

func nuevoObjeto() *objeto { return &objeto{pares: make([]par, 0, 4)} }

func (o *objeto) indice(k string) int {
	for i := range o.pares {
		if o.pares[i].k == k {
			return i
		}
	}
	return -1
}

func (o *objeto) get(k string) (valor, bool) {
	if i := o.indice(k); i >= 0 {
		return o.pares[i].v, true
	}
	return nil, false
}

func (o *objeto) poner(k string, v valor) {
	if i := o.indice(k); i >= 0 {
		o.pares[i].v = v
		return
	}
	o.pares = append(o.pares, par{k, v})
}

func (o *objeto) largo() int { return len(o.pares) }

// errorJS es un `throw new Error(mensaje)`: el mensaje llega tal cual al
// "No se pudo abrir el Excel: …".
type errorJS struct{ mensaje string }

func (e *errorJS) Error() string { return e.mensaje }

func fallar(formato string, args ...any) error {
	return &errorJS{fmt.Sprintf(formato, args...)}
}

// errNoSoportado marca lo que el TS lee y acá no se reproduce (las
// declaraciones de un DOCTYPE). Un .xlsx de verdad no las trae.
var errNoSoportado = errors.New("el .xlsx trae un DOCTYPE con declaraciones, que no se leen")

type u16 = []uint16

func aU16(s string) u16 { return utf16.Encode([]rune(s)) }
func deU16(s u16) string {
	ascii := true
	for _, c := range s {
		if c >= 0x80 {
			ascii = false
			break
		}
	}
	if !ascii {
		return string(utf16.Decode(s))
	}
	b := make([]byte, len(s))
	for i, c := range s {
		b[i] = byte(c)
	}
	return string(b)
}
func esEspacioU(c uint16) bool { return esEspacioJS(rune(c)) }

func trimU(s u16) u16 {
	i, j := 0, len(s)
	for i < j && esEspacioU(s[i]) {
		i++
	}
	for j > i && esEspacioU(s[j-1]) {
		j--
	}
	return s[i:j]
}

func trimInicioU(s u16) u16 {
	i := 0
	for i < len(s) && esEspacioU(s[i]) {
		i++
	}
	return s[i:]
}

func igualesU(a, b u16) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// indiceU es indexOf(aguja, desde).
// La aguja es siempre ASCII (">", "-->", "]]>").
func indiceU(s u16, aguja string, desde int) int {
	desde = max(desde, 0)
siguiente:
	for i := desde; i+len(aguja) <= len(s); i++ {
		for k := 0; k < len(aguja); k++ {
			if s[i+k] != uint16(aguja[k]) {
				continue siguiente
			}
		}
		return i
	}
	return -1
}

// subcadenaU es String.prototype.substring: recorta a los bordes e invierte
// los extremos si vienen al revés.
func subcadenaU(s u16, a, b int) u16 {
	a = max(0, min(a, len(s)))
	b = max(0, min(b, len(s)))
	if a > b {
		a, b = b, a
	}
	return s[a:b]
}

// Los nombres que fast-xml-parser no deja usar como etiqueta (tiran error) y
// los que renombra con "__" adelante.
var (
	criticos   = map[string]bool{"__proto__": true, "constructor": true, "prototype": true}
	peligrosos = map[string]bool{
		"hasOwnProperty": true, "toString": true, "valueOf": true,
		"__defineGetter__": true, "__defineSetter__": true,
		"__lookupGetter__": true, "__lookupSetter__": true,
	}
)

func sanear(nombre string) (string, error) {
	if criticos[nombre] {
		return "", fallar(`[SECURITY] Invalid name: "%s" is a reserved JavaScript keyword that could cause prototype pollution`, nombre)
	}
	if peligrosos[nombre] {
		return "__" + nombre, nil
	}
	return nombre, nil
}

// nodoXML es un xmlNode del parser: hijos en orden (textos y etiquetas).
type nodoXML struct {
	etiqueta string
	hijos    []hijoXML
	attrs    *objeto
}

type hijoXML struct {
	texto *string
	nodo  *nodoXML
}

type parserXML struct {
	d         u16
	version11 bool
}

const maxAnidadas = 100

func parsearXML(texto string) (*objeto, error) {
	// xmlData.replace(/\r\n?/g, "\n")
	crudo := aU16(texto)
	d := make(u16, 0, len(crudo))
	for i := 0; i < len(crudo); i++ {
		c := crudo[i]
		if c == '\r' {
			if i+1 < len(crudo) && crudo[i+1] == '\n' {
				i++
			}
			c = '\n'
		}
		d = append(d, c)
	}
	p := &parserXML{d: d}
	raiz, err := p.parsear()
	if err != nil {
		return nil, err
	}
	return comprimir(raiz.hijos), nil
}

func (p *parserXML) en(i int) int {
	if i < 0 || i >= len(p.d) {
		return -1
	}
	return int(p.d[i])
}

func agregarTexto(n *nodoXML, s string) {
	n.hijos = append(n.hijos, hijoXML{texto: &s})
}

func (p *parserXML) parsear() (*nodoXML, error) {
	d := p.d
	raiz := &nodoXML{etiqueta: "!xml"}
	actual := raiz
	var pila []*nodoXML
	var texto u16
	doctype := false

	guardarTexto := func() {
		if len(texto) > 0 {
			v := trimU(texto)
			if len(v) > 0 {
				v = p.entidades(v)
				if len(v) > 0 {
					agregarTexto(actual, deU16(v))
				}
			}
		}
		texto = texto[:0]
	}

	for i := 0; i < len(d); i++ {
		if d[i] != '<' {
			texto = append(texto, d[i])
			continue
		}
		c1 := p.en(i + 1)
		switch {
		case c1 == '/':
			cierre := indiceU(d, ">", i)
			if cierre < 0 {
				return nil, fallar("Closing Tag is not closed.")
			}
			if _, err := sanear(deU16(trimU(subcadenaU(d, i+2, cierre)))); err != nil {
				return nil, err
			}
			guardarTexto()
			// El nombre del cierre no se compara con nada: cierra lo que haya.
			if len(pila) > 0 {
				actual = pila[len(pila)-1]
				pila = pila[:len(pila)-1]
			} else {
				actual = raiz
			}
			texto = texto[:0]
			i = cierre

		case c1 == '?':
			et, ok := p.leerEtiqueta(i, "?>")
			if !ok {
				return nil, fallar("Pi Tag is not closed.")
			}
			guardarTexto()
			attrs := p.atributos(et.exp)
			if attrs != nil {
				ver, _ := attrs.get("@version")
				p.version11 = numeroDe(ver) == 1.1
			}
			nodo := &nodoXML{etiqueta: deU16(et.nombre)}
			agregarTexto(nodo, "")
			if !igualesU(et.nombre, et.exp) {
				nodo.attrs = attrs
			}
			actual.hijos = append(actual.hijos, hijoXML{nodo: nodo})
			i = et.cierre + 1

		case c1 == '!' && p.en(i+2) == '-' && p.en(i+3) == '-':
			fin := indiceU(d, "-->", i+4)
			if fin < 0 {
				return nil, fallar("Comment is not closed.")
			}
			i = fin + 2

		case c1 == '!' && p.en(i+2) == 'D':
			if doctype {
				return nil, fallar("Multiple DOCTYPE declarations found.")
			}
			doctype = true
			fin, err := p.leerDoctype(i)
			if err != nil {
				return nil, err
			}
			i = fin

		case c1 == '!' && p.en(i+2) == '[':
			fin := indiceU(d, "]]>", i)
			if fin < 0 {
				return nil, fallar("CDATA is not closed.")
			}
			cdata := subcadenaU(d, i+9, fin)
			guardarTexto()
			// El CDATA entra entero: sin recortar y sin entidades, aunque esté vacío.
			agregarTexto(actual, deU16(cdata))
			i = fin + 2

		default:
			et, ok := p.leerEtiqueta(i, ">")
			if !ok {
				ctx := subcadenaU(d, max(0, i-50), min(len(d), i+50))
				return nil, fallar(`readTagExp returned undefined at position %d. Context: "%s"`, i, deU16(ctx))
			}
			nombreTxt, err := sanear(deU16(et.nombre))
			if err != nil {
				return nil, err
			}
			nombre := aU16(nombreTxt)
			exp := et.exp
			if nombreTxt == "#text" {
				return nil, fallar("Invalid tag name: #text")
			}
			// El TS compara el nombre, no el nodo: una etiqueta <!xml> cuenta como raíz.
			if actual.etiqueta != "!xml" && len(texto) > 0 {
				guardarTexto()
			}

			autocierre := false
			hayAtributos := true
			if len(exp) > 0 && exp[len(exp)-1] == '/' {
				autocierre = true
				if len(nombre) > 0 && nombre[len(nombre)-1] == '/' {
					nombre = nombre[:len(nombre)-1]
					exp = nombre
				} else {
					exp = exp[:len(exp)-1]
				}
				hayAtributos = !igualesU(nombre, exp)
			}

			var attrs *objeto
			if !igualesU(nombre, exp) && hayAtributos {
				attrs = p.atributos(exp)
			}

			if autocierre {
				nombreTxt, err = sanear(deU16(nombre))
				if err != nil {
					return nil, err
				}
				actual.hijos = append(actual.hijos, hijoXML{nodo: &nodoXML{etiqueta: nombreTxt, attrs: attrs}})
			} else {
				if len(pila) > maxAnidadas {
					return nil, fallar("Maximum nested tags exceeded")
				}
				pila = append(pila, actual)
				nodo := &nodoXML{etiqueta: deU16(nombre), attrs: attrs}
				actual.hijos = append(actual.hijos, hijoXML{nodo: nodo})
				actual = nodo
			}
			texto = texto[:0]
			i = et.cierre
		}
	}
	return raiz, nil
}

type etiquetaLeida struct {
	nombre, exp u16
	cierre      int
}

// leerEtiqueta es readTagExp: lee desde el "<" hasta el cierre (">" o "?>")
// que no esté entre comillas, cambia los tabuladores por espacios y separa el
// nombre en el primer espacio.
func (p *parserXML) leerEtiqueta(i int, cierre string) (etiquetaLeida, bool) {
	d := p.d
	c0 := uint16(cierre[0])
	c1 := -1
	if len(cierre) > 1 {
		c1 = int(cierre[1])
	}
	var dato u16
	comilla := uint16(0)
	inicio := i + 1
	fin := -1
	for k := i + 1; k < len(d); k++ {
		c := d[k]
		if comilla != 0 {
			if c == comilla {
				comilla = 0
			}
			continue
		}
		if c == '"' || c == '\'' {
			comilla = c
			continue
		}
		if c == c0 {
			if c1 == -1 || p.en(k+1) == c1 {
				if dato == nil {
					dato = d[inicio:k:k] // sin tabuladores no hace falta copiar (y nadie lo escribe)
				} else {
					dato = append(dato, d[inicio:k]...)
				}
				fin = k
				break
			}
			continue
		}
		if c == '\t' {
			dato = append(dato, d[inicio:k]...)
			dato = append(dato, ' ')
			inicio = k + 1
		}
	}
	if fin < 0 {
		return etiquetaLeida{}, false
	}
	et := etiquetaLeida{nombre: dato, exp: dato, cierre: fin}
	for k, c := range dato {
		if esEspacioU(c) {
			et.nombre = dato[:k]
			et.exp = trimInicioU(dato[k+1:])
			break
		}
	}
	return et, true
}

// atributos es buildAttributesMap con la expresión
// /([^\s=]+)\s*(=\s*(['"])([\s\S]*?)\3)?/g: los atributos sin valor entre
// comillas no entran, el valor se recorta y se le resuelven las entidades.
// Devuelve nil si no quedó ninguno.
func (p *parserXML) atributos(s u16) *objeto {
	var attrs *objeto
	pos := 0
	for pos < len(s) {
		if esEspacioU(s[pos]) || s[pos] == '=' {
			pos++
			continue
		}
		inicio := pos
		for pos < len(s) && !esEspacioU(s[pos]) && s[pos] != '=' {
			pos++
		}
		nombre := s[inicio:pos]
		k := pos
		for k < len(s) && esEspacioU(s[k]) {
			k++
		}
		if k >= len(s) || s[k] != '=' {
			continue
		}
		k++
		for k < len(s) && esEspacioU(s[k]) {
			k++
		}
		if k >= len(s) || (s[k] != '"' && s[k] != '\'') {
			continue
		}
		q := s[k]
		fin := -1
		for m := k + 1; m < len(s); m++ {
			if s[m] == q {
				fin = m
				break
			}
		}
		if fin < 0 {
			continue
		}
		v := p.entidades(trimU(s[k+1 : fin]))
		pos = fin + 1
		if attrs == nil {
			attrs = nuevoObjeto()
		}
		attrs.poner("@"+deU16(nombre), deU16(v))
	}
	return attrs
}

// entidades es EntityDecoder.decode con lo que configura fast-xml-parser:
// solo amp, apos, gt, lt y quot; las referencias numéricas quedan escritas
// (htmlEntities: false), salvo las prohibidas (U+0000, sustitutos y, en XML
// 1.0, los controles C0 menos tab, LF y CR), que se borran.
func (p *parserXML) entidades(s u16) u16 {
	hay := false
	for _, c := range s {
		if c == '&' {
			hay = true
			break
		}
	}
	if !hay {
		return s
	}
	var out u16
	ultimo := 0
	for i := 0; i < len(s); {
		if s[i] != '&' {
			i++
			continue
		}
		j := i + 1
		for j < len(s) && s[j] != ';' && j-i <= 32 {
			j++
		}
		if j >= len(s) || s[j] != ';' {
			i++
			continue
		}
		token := s[i+1 : j]
		if len(token) == 0 {
			i++
			continue
		}
		var reemplazo u16
		if token[0] == '#' {
			if !p.ncrProhibida(token) {
				i++
				continue
			}
			reemplazo = u16{}
		} else {
			switch deU16(token) {
			case "amp":
				reemplazo = u16{'&'}
			case "apos":
				reemplazo = u16{'\''}
			case "gt":
				reemplazo = u16{'>'}
			case "lt":
				reemplazo = u16{'<'}
			case "quot":
				reemplazo = u16{'"'}
			default:
				i++
				continue
			}
		}
		out = append(out, s[ultimo:i]...)
		out = append(out, reemplazo...)
		ultimo = j + 1
		i = ultimo
	}
	if out == nil {
		return s
	}
	return append(out, s[ultimo:]...)
}

// ncrProhibida dice si la referencia numérica se borra (true) o queda
// escrita (false).
func (p *parserXML) ncrProhibida(token u16) bool {
	var cp float64
	if len(token) > 1 && (token[1] == 'x' || token[1] == 'X') {
		cp = parseIntJS(token[2:], 16)
	} else {
		cp = parseIntJS(token[1:], 10)
	}
	if math.IsNaN(cp) || cp < 0 || cp > 0x10ffff {
		return false
	}
	switch {
	case cp == 0:
		return true
	case cp >= 0xd800 && cp <= 0xdfff:
		return true
	case !p.version11 && cp >= 1 && cp <= 0x1f && cp != 9 && cp != 10 && cp != 13:
		return true
	}
	return false
}

// parseIntJS es parseInt(s, base) para base 10 y 16: espacios adelante,
// signo, "0x" opcional en base 16, y el prefijo más largo de dígitos válidos.
func parseIntJS(s u16, base int) float64 {
	s = trimInicioU(s)
	signo := 1.0
	if len(s) > 0 && (s[0] == '+' || s[0] == '-') {
		if s[0] == '-' {
			signo = -1
		}
		s = s[1:]
	}
	if base == 16 && len(s) >= 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X') {
		s = s[2:]
	}
	v, hay := 0.0, false
	for _, c := range s {
		var d int
		switch {
		case c >= '0' && c <= '9':
			d = int(c - '0')
		case base == 16 && c >= 'a' && c <= 'f':
			d = int(c-'a') + 10
		case base == 16 && c >= 'A' && c <= 'F':
			d = int(c-'A') + 10
		default:
			d = -1
		}
		if d < 0 {
			break
		}
		hay = true
		if v < 1e300 {
			v = float64(v*float64(base)) + float64(d)
		}
	}
	if !hay {
		return math.NaN()
	}
	return signo * v
}

// leerDoctype es DocTypeReader.readDocType sin las declaraciones: se saltea
// el DOCTYPE con sus comentarios y ATTLIST; ENTITY, ELEMENT y NOTATION no se
// reproducen (errNoSoportado). Devuelve el índice del ">" final.
func (p *parserXML) leerDoctype(i int) (int, error) {
	d := p.d
	if !(p.en(i+3) == 'O' && p.en(i+4) == 'C' && p.en(i+5) == 'T' && p.en(i+6) == 'Y' && p.en(i+7) == 'P' && p.en(i+8) == 'E') {
		return 0, fallar("Invalid Tag instead of DOCTYPE")
	}
	sigue := func(seq string, k int) bool {
		for j := 0; j < len(seq); j++ {
			if p.en(k+j+1) != int(seq[j]) {
				return false
			}
		}
		return true
	}
	i += 9
	angulos := 1
	cuerpo, comentario := false, false
	comilla := -1
	for ; i < len(d); i++ {
		c := int(d[i])
		if comilla != -1 {
			if c == comilla {
				comilla = -1
			}
			continue
		}
		if !cuerpo && !comentario && (c == '"' || c == '\'') {
			comilla = c
			continue
		}
		switch {
		case c == '<' && !comentario:
			switch {
			case cuerpo && (sigue("!ENTITY", i) || sigue("!ELEMENT", i) || sigue("!NOTATION", i)):
				return 0, errNoSoportado
			case cuerpo && sigue("!ATTLIST", i):
				i += 8
			case sigue("!--", i):
				comentario = true
			default:
				return 0, fallar("Invalid DOCTYPE")
			}
			angulos++
		case c == '>':
			if comentario {
				if p.en(i-1) == '-' && p.en(i-2) == '-' {
					comentario = false
					angulos--
				}
			} else {
				angulos--
			}
		case c == '[':
			cuerpo = true
		}
		if c == '>' && angulos == 0 {
			break
		}
	}
	if comilla != -1 || angulos != 0 {
		return 0, fallar("Unclosed DOCTYPE")
	}
	return i, nil
}

// comprimir es node2json.compress: cada etiqueta pasa a ser una clave; los
// hermanos repetidos, un arreglo; una etiqueta con solo texto y sin
// atributos, el texto; una vacía y sin atributos, "".
func comprimir(hijos []hijoXML) *objeto {
	obj := nuevoObjeto()
	var texto *string
	for _, h := range hijos {
		if h.texto != nil {
			if texto == nil {
				t := *h.texto
				texto = &t
			} else {
				*texto += *h.texto
			}
			continue
		}
		n := h.nodo
		if n.etiqueta == ":@" {
			continue // en el TS la clave se pisa con la de los atributos y se pierde
		}
		hijo := comprimir(n.hijos)
		var v valor = hijo
		if n.attrs != nil && n.attrs.largo() > 0 {
			for _, a := range n.attrs.pares {
				hijo.poner(a.k, a.v)
			}
		} else if t, ok := hijo.get("#text"); ok && hijo.largo() == 1 {
			v = t
		} else if hijo.largo() == 0 {
			v = ""
		}
		if i := obj.indice(n.etiqueta); i >= 0 {
			lista, esLista := obj.pares[i].v.([]valor)
			if !esLista {
				lista = []valor{obj.pares[i].v}
			}
			obj.pares[i].v = append(lista, v)
		} else {
			obj.poner(n.etiqueta, v)
		}
	}
	if texto != nil && *texto != "" {
		obj.poner("#text", *texto)
	}
	return obj
}
