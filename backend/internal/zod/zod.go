// Package zod valida los formularios de las acciones de Next como lo hacían
// sus esquemas de zod 4: mismo orden, mismos mensajes, y el primer problema
// con su campo. El formulario llega como objeto libre (map[string]any):
// faltar, venir en null o con otro tipo son cosas distintas, y zod las
// distinguía.
//
// Lo usan las tandas que mudan acciones con formularios de texto (la 10:
// campañas, avisos, profesionales y eventos). La tanda 8 tiene el suyo en
// internal/compras/zod.go, más grande (números, fechas, arreglos).
package zod

import (
	"fmt"
	"math"
	"regexp"
	"strings"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
)

// Espacio es \s de JavaScript (y lo que saca String.prototype.trim).
func Espacio(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// ClaseEspacio es \s de JavaScript para meter en una expresión regular de Go
// (la \s de RE2 es solo ASCII).
const ClaseEspacio = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// Trim es String.prototype.trim.
func Trim(s string) string { return strings.TrimFunc(s, Espacio) }

// Lector recorre el formulario y se queda con el primer problema.
type Lector struct {
	m             map[string]any
	campo, error  string
	Valores       map[string]string
	presente      map[string]bool
	OpcionalVacio bool // si "" en un opcional es como no venir (`… || undefined`)
}

// Nuevo arma el lector. Los opcionales que llegan como "" se tratan como
// ausentes: es lo que hacía `(formData.get(x) as string) || undefined`.
func Nuevo(m map[string]any) *Lector {
	if m == nil {
		m = map[string]any{}
	}
	return &Lector{m: m, Valores: map[string]string{}, presente: map[string]bool{}, OpcionalVacio: true}
}

// Mal anota un problema (si no había otro antes).
func (l *Lector) Mal(campo, mensaje string) {
	if l.error == "" {
		l.campo, l.error = campo, mensaje
	}
}

// Ok dice si todavía no hubo problemas.
func (l *Lector) Ok() bool { return l.error == "" }

// Problema es el primero, listo para devolver (nil si no hubo).
func (l *Lector) Problema() error {
	if l.error == "" {
		return nil
	}
	return plataforma.Invalido(map[string]string{l.campo: l.error})
}

// Primero es el campo y el mensaje del primer problema.
func (l *Lector) Primero() (string, string) { return l.campo, l.error }

// Tiene dice si el campo vino (y no fue un opcional vacío).
func (l *Lector) Tiene(campo string) bool { return l.presente[campo] }

// Texto devuelve el valor ya leído ("" si no vino).
func (l *Lector) Texto(campo string) string { return l.Valores[campo] }

func recibido(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case bool:
		return "boolean"
	case float64:
		return "number"
	case map[string]any:
		return "object"
	case []any:
		return "array"
	}
	return "unknown"
}

// Cadena es el comienzo de un z.string(): lee el campo y dice si sigue.
type Cadena struct {
	l     *Lector
	campo string
	v     string
	vivo  bool
}

// String lee un campo de texto. Con opcional, si no vino (o vino vacío) no
// se valida nada más.
func (l *Lector) String(campo string, opcional bool) *Cadena {
	c := &Cadena{l: l, campo: campo}
	crudo, esta := l.m[campo]
	if opcional && (!esta || crudo == nil || (l.OpcionalVacio && crudo == "")) {
		return c
	}
	if !esta {
		l.Mal(campo, "Invalid input: expected string, received undefined")
		return c
	}
	s, ok := crudo.(string)
	if !ok {
		l.Mal(campo, "Invalid input: expected string, received "+recibido(crudo))
		return c
	}
	c.v, c.vivo = s, true
	l.presente[campo] = true
	l.Valores[campo] = s
	return c
}

// Trim es .trim().
func (c *Cadena) Trim() *Cadena {
	if c.vivo {
		c.v = Trim(c.v)
		c.l.Valores[c.campo] = c.v
	}
	return c
}

func (c *Cadena) mal(m string) {
	c.l.Mal(c.campo, m)
	c.vivo = false
}

// Min es .min(n, mensaje); sin mensaje, el de zod.
func (c *Cadena) Min(n int, mensaje string) *Cadena {
	if c.vivo && plataforma.LargoJS(c.v) < n {
		if mensaje == "" {
			mensaje = fmt.Sprintf("Too small: expected string to have >=%d characters", n)
		}
		c.mal(mensaje)
	}
	return c
}

// Max es .max(n, mensaje); sin mensaje, el de zod.
func (c *Cadena) Max(n int, mensaje string) *Cadena {
	if c.vivo && plataforma.LargoJS(c.v) > n {
		if mensaje == "" {
			mensaje = fmt.Sprintf("Too big: expected string to have <=%d characters", n)
		}
		c.mal(mensaje)
	}
	return c
}

// UUID es .uuid().
func (c *Cadena) UUID() *Cadena {
	if c.vivo && !plataforma.UUIDValido(c.v) {
		c.mal("Invalid UUID")
	}
	return c
}

// Email es .email(mensaje).
func (c *Cadena) Email(mensaje string) *Cadena {
	if c.vivo && !plataforma.CorreoValido(c.v) {
		c.mal(mensaje)
	}
	return c
}

// Refinar es .refine(f, mensaje).
func (c *Cadena) Refinar(f func(string) bool, mensaje string) *Cadena {
	if c.vivo && !f(c.v) {
		c.mal(mensaje)
	}
	return c
}

// Valor es el texto (ya recortado si correspondía).
func (c *Cadena) Valor() string { return c.v }

// Enum es z.enum([...]): cualquier otra cosa da «Invalid option».
func (l *Lector) Enum(campo string, opciones ...string) string {
	if v, ok := l.m[campo].(string); ok {
		for _, o := range opciones {
			if v == o {
				l.presente[campo] = true
				l.Valores[campo] = v
				return v
			}
		}
	}
	l.Mal(campo, "Invalid option: expected one of \""+strings.Join(opciones, "\"|\"")+"\"")
	return ""
}

// Booleano es z.boolean().
func (l *Lector) Booleano(campo string) bool {
	v, ok := l.m[campo].(bool)
	if !ok {
		l.Mal(campo, "Invalid input: expected boolean, received "+recibido(l.m[campo]))
	}
	return v
}

// EnteroCoercido es z.coerce.number().int().min(a).max(b).
func (l *Lector) EnteroCoercido(campo string, a, b float64) float64 {
	var n float64
	switch v := l.m[campo].(type) {
	case nil:
		n = 0
	case float64:
		n = v
	case string:
		n = jsmath.Numero(v)
	case bool:
		if v {
			n = 1
		}
	default:
		n = math.NaN()
	}
	switch {
	case math.IsNaN(n):
		l.Mal(campo, "Invalid input: expected number, received NaN")
	case math.IsInf(n, 0):
		l.Mal(campo, "Invalid input: expected number, received number")
	case n != math.Trunc(n):
		l.Mal(campo, "Invalid input: expected int, received number")
	case n < a:
		l.Mal(campo, "Too small: expected number to be >="+jsmath.Texto(a))
	case n > b:
		l.Mal(campo, "Too big: expected number to be <="+jsmath.Texto(b))
	}
	return n
}

var enlaceRe = regexp.MustCompile(`^https?://`)

// EsEnlace es la regla de los enlaces de las campañas: vacío, http(s):// o
// una ruta del sitio.
func EsEnlace(v string) bool { return v == "" || enlaceRe.MatchString(v) || strings.HasPrefix(v, "/") }
