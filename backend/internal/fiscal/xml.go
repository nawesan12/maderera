package fiscal

import (
	"encoding/xml"
	"errors"
	"io"
	"strings"
)

// Las respuestas de ARCA se leen como las leía fast-xml-parser en el TS
// ({ignoreAttributes, removeNSPrefix, parseTagValue: false}): sin atributos,
// sin prefijos, todo como texto recortado, y un elemento repetido es una
// lista. Lo que el TS hacía con esa forma —`a?.b?.c`, `Array.isArray`— se
// imita con los métodos de nodo, para que una respuesta rara dé lo mismo.

// nodo es un elemento: su texto (si no tiene hijos) y sus hijos por nombre.
type nodo struct {
	texto string
	hijos map[string][]*nodo
}

// esTexto: un elemento sin hijos es un string en fast-xml-parser.
func (n *nodo) esTexto() bool { return n != nil && len(n.hijos) == 0 }

// h es `n?.nombre` cuando hay un solo elemento con ese nombre. Si hay varios
// (una lista en JS) o ninguno, o n es texto, nil.
func (n *nodo) h(nombre string) *nodo {
	if n == nil || n.esTexto() {
		return nil
	}
	l := n.hijos[nombre]
	if len(l) != 1 {
		return nil
	}
	return l[0]
}

// lista es `Array.isArray(v) ? v : v ? [v] : []`.
func (n *nodo) lista(nombre string) []*nodo {
	if n == nil || n.esTexto() {
		return nil
	}
	return n.hijos[nombre]
}

// cadena es String(v) para un valor que el TS interpolaba: el texto, o
// "[object Object]" si era un objeto.
func (n *nodo) cadena() string {
	if n == nil {
		return ""
	}
	if n.esTexto() {
		return n.texto
	}
	return "[object Object]"
}

// leerXML arma el árbol. Un documento roto da error, como el parser del TS
// (que tiraba y la llamada caía en el catch).
func leerXML(texto string) (*nodo, error) {
	d := xml.NewDecoder(strings.NewReader(texto))
	d.Strict = false
	raiz := &nodo{hijos: map[string][]*nodo{}}
	pila := []*nodo{raiz}
	textos := []*strings.Builder{{}}
	for {
		tok, err := d.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			n := &nodo{hijos: map[string][]*nodo{}}
			padre := pila[len(pila)-1]
			padre.hijos[t.Name.Local] = append(padre.hijos[t.Name.Local], n)
			pila = append(pila, n)
			textos = append(textos, &strings.Builder{})
		case xml.EndElement:
			if len(pila) <= 1 {
				return nil, errors.New("xml: cierre de más")
			}
			n := pila[len(pila)-1]
			n.texto = strings.TrimSpace(textos[len(textos)-1].String())
			pila = pila[:len(pila)-1]
			textos = textos[:len(textos)-1]
		case xml.CharData:
			textos[len(textos)-1].Write(t)
		}
	}
	if len(pila) != 1 {
		return nil, errors.New("xml: elemento sin cerrar")
	}
	return raiz, nil
}

// escapar es la función xml() de arca.ts: &, <, > y comillas dobles.
func escapar(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}
