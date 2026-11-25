// Package zodjs lee un objeto JSON (map[string]any) como lo leían los
// esquemas de zod 4 del TypeScript, para dar **el mismo primer error** (con su
// campo) que veía la pantalla o la cola del mostrador: `issues[0]`.
//
// Es la versión exportada del lector de internal/compras/zod.go (tanda 8),
// con lo que faltaba para el mostrador y las ventas: z.number() sin coerce,
// z.boolean(), .datetime(), .regex() y los objetos y listas anidados. zod
// recorre las claves en el orden del esquema y los elementos de una lista en
// orden, y reporta primero los elementos y después el largo: basta con leer
// en ese orden y quedarse con el primer problema.
//
// Un NaN de JS viaja por JSON como null: en los z.number() se lo trata como
// null (que es lo que llega por la red); ver progreso.md, tanda 5.
package zodjs

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
)

// Lector recorre un objeto y guarda el primer problema.
type Lector struct {
	m      map[string]any
	ruta   string
	campo  string
	error  string
	padres *Lector
}

// Leer empieza a leer un objeto.
func Leer(m map[string]any) *Lector { return &Lector{m: m} }

// Raiz lee lo que vino como cuerpo: si no es un objeto, el problema es ese
// («expected object, received null» para un JSON roto, como safeParse(null)).
func Raiz(v any) *Lector {
	m, es := v.(map[string]any)
	if !es {
		l := &Lector{m: map[string]any{}}
		l.mal("", "Invalid input: expected object, received "+TipoJS(v, true))
		return l
	}
	return Leer(m)
}

func (l *Lector) raiz() *Lector {
	for l.padres != nil {
		l = l.padres
	}
	return l
}

func (l *Lector) mal(campo, mensaje string) {
	r := l.raiz()
	if r.error != "" {
		return
	}
	r.campo, r.error = strings.TrimSuffix(l.ruta+campo, "."), mensaje
}

// Mal anota un problema propio (un .refine, un mensaje de la acción) si
// todavía no hay otro.
func (l *Lector) Mal(campo, mensaje string) { l.mal(campo, mensaje) }

// Ok: todavía no hubo problemas.
func (l *Lector) Ok() bool { return l.raiz().error == "" }

// Primero es el primer problema: el campo (con su ruta, «lineas.0.cantidad»)
// y el mensaje. Vacíos si no hubo.
func (l *Lector) Primero() (campo, mensaje string) {
	r := l.raiz()
	return r.campo, r.error
}

// Problema es el primero como 422 (nil si no hubo).
func (l *Lector) Problema() error {
	r := l.raiz()
	if r.error == "" {
		return nil
	}
	campo := r.campo
	if campo == "" {
		campo = "_"
	}
	return plataforma.Invalido(map[string]string{campo: r.error})
}

// Esta dice si el campo vino (undefined es «no vino»).
func (l *Lector) Esta(campo string) bool {
	_, ok := l.m[campo]
	return ok
}

// Crudo es el valor tal cual vino.
func (l *Lector) Crudo(campo string) (any, bool) {
	v, ok := l.m[campo]
	return v, ok
}

func (l *Lector) hijo(ruta string, m map[string]any) *Lector {
	return &Lector{m: m, ruta: ruta, padres: l}
}

// TipoJS es lo que zod dice que recibió.
func TipoJS(v any, esta bool) string {
	if !esta {
		return "undefined"
	}
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case bool:
		return "boolean"
	case float64:
		if math.IsNaN(x) {
			return "NaN"
		}
		return "number"
	case []any:
		return "array"
	}
	return "object"
}

// NumeroJS es Number(v), el de z.coerce.number().
func NumeroJS(v any, esta bool) float64 {
	if !esta {
		return math.NaN()
	}
	switch x := v.(type) {
	case nil:
		return 0 // Number(null) es 0
	case float64:
		return x
	case string:
		return jsmath.Numero(x)
	case bool:
		if x {
			return 1
		}
		return 0
	case []any:
		return jsmath.Numero(TextoJS(x)) // Number([]) es 0, Number([5]) es 5
	}
	return math.NaN()
}

// TextoJS es String(v) de JS para lo que llega por JSON.
func TextoJS(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case float64:
		return jsmath.Texto(x)
	case bool:
		if x {
			return "true"
		}
		return "false"
	case []any:
		partes := make([]string, len(x))
		for i, e := range x {
			if e != nil {
				partes[i] = TextoJS(e)
			}
		}
		return strings.Join(partes, ",")
	}
	return "[object Object]"
}

// Regla es un control de z.number() en el orden en que se escribió.
type Regla struct {
	tipo    string // "int", ">", ">=", "<="
	limite  float64
	mensaje string
}

// Entero es .int().
func Entero() Regla { return Regla{tipo: "int"} }

// Positivo es .positive().
func Positivo() Regla { return Regla{">", 0, ""} }

// Min es .min(n).
func Min(n float64) Regla { return Regla{">=", n, ""} }

// Max es .max(n).
func Max(n float64) Regla { return Regla{"<=", n, ""} }

// ConMensaje le pone el mensaje propio a una regla.
func (r Regla) ConMensaje(m string) Regla { r.mensaje = m; return r }

// Num dice cómo es un z.number().
type Num struct {
	Coerce   bool // z.coerce.number()
	Opcional bool // .optional()
	Nulo     bool // .nullable()
	Defecto  *float64
}

// Numero lee un número. Devuelve nil si no vino (opcional) o vino null
// (nullable).
func (l *Lector) Numero(campo string, o Num, reglas ...Regla) *float64 {
	v, esta := l.m[campo]
	if !esta {
		if o.Defecto != nil {
			d := *o.Defecto
			return &d
		}
		if o.Opcional {
			return nil
		}
	}
	if esta && v == nil && o.Nulo {
		return nil
	}
	var n float64
	if o.Coerce {
		n = NumeroJS(v, esta)
		if math.IsNaN(n) {
			l.mal(campo, "Invalid input: expected number, received NaN")
			return &n
		}
	} else {
		x, es := v.(float64)
		if !es || math.IsNaN(x) {
			l.mal(campo, "Invalid input: expected number, received "+TipoJS(v, esta))
			return nil
		}
		n = x
	}
	if math.IsInf(n, 0) {
		l.mal(campo, "Invalid input: expected number, received number")
		return &n
	}
	for _, r := range reglas {
		mensaje := r.mensaje
		falla := false
		switch r.tipo {
		case "int":
			falla = n != math.Trunc(n) || math.Abs(n) > 9007199254740991
			if mensaje == "" {
				mensaje = "Invalid input: expected int, received number"
			}
		case ">":
			falla = !(n > r.limite)
			if mensaje == "" {
				mensaje = "Too small: expected number to be >" + jsmath.Texto(r.limite)
			}
		case ">=":
			falla = !(n >= r.limite)
			if mensaje == "" {
				mensaje = "Too small: expected number to be >=" + jsmath.Texto(r.limite)
			}
		case "<=":
			falla = !(n <= r.limite)
			if mensaje == "" {
				mensaje = "Too big: expected number to be <=" + jsmath.Texto(r.limite)
			}
		}
		if falla {
			l.mal(campo, mensaje)
			return &n
		}
	}
	return &n
}

// Texto dice cómo es un z.string().
type Texto struct {
	Opcional, Nulo, Recortar bool
	Min, Max                 int
	MsjMin, MsjMax           string
	UUID                     bool
	MsjUUID                  string
	Patron                   *regexp.Regexp
	MsjPatron                string
	FechaHora                bool // .datetime()
	Defecto                  *string
}

// Cadena lee un z.string(). Devuelve el valor (nil si no vino o vino null y
// se admitía).
func (l *Lector) Cadena(campo string, o Texto) *string {
	v, esta := l.m[campo]
	if !esta {
		if o.Defecto != nil {
			d := *o.Defecto
			return &d
		}
		if o.Opcional {
			return nil
		}
	}
	if esta && v == nil && o.Nulo {
		return nil
	}
	s, es := v.(string)
	if !es {
		l.mal(campo, "Invalid input: expected string, received "+TipoJS(v, esta))
		return nil
	}
	if o.Recortar {
		s = TrimJS(s)
	}
	if o.Min > 0 && LargoJS(s) < o.Min {
		m := o.MsjMin
		if m == "" {
			m = fmt.Sprintf("Too small: expected string to have >=%d characters", o.Min)
		}
		l.mal(campo, m)
		return &s
	}
	if o.Max > 0 && LargoJS(s) > o.Max {
		m := o.MsjMax
		if m == "" {
			m = fmt.Sprintf("Too big: expected string to have <=%d characters", o.Max)
		}
		l.mal(campo, m)
		return &s
	}
	if o.Patron != nil && !o.Patron.MatchString(s) {
		m := o.MsjPatron
		if m == "" {
			m = "Invalid string: must match pattern " + o.Patron.String()
		}
		l.mal(campo, m)
		return &s
	}
	if o.UUID && !plataforma.UUIDValido(s) {
		m := o.MsjUUID
		if m == "" {
			m = "Invalid UUID"
		}
		l.mal(campo, m)
		return &s
	}
	if o.FechaHora && !fechaHora.MatchString(s) {
		l.mal(campo, "Invalid ISO datetime")
	}
	return &s
}

// Requerido es un z.string() obligatorio: "" si faltó.
func (l *Lector) Requerido(campo string, o Texto) string {
	s := l.Cadena(campo, o)
	if s == nil {
		return ""
	}
	return *s
}

// Booleano es z.boolean() (.optional() si `opcional`).
func (l *Lector) Booleano(campo string, opcional bool) *bool {
	v, esta := l.m[campo]
	if !esta && opcional {
		return nil
	}
	b, es := v.(bool)
	if !es {
		l.mal(campo, "Invalid input: expected boolean, received "+TipoJS(v, esta))
		return nil
	}
	return &b
}

// Opcion es z.enum([...]): con `defecto` si no vino (.default), nil si no
// vino y es opcional, o null si es nullable.
func (l *Lector) Opcion(campo string, o Opciones, valores ...string) *string {
	v, esta := l.m[campo]
	if !esta {
		if o.Defecto != "" {
			d := o.Defecto
			return &d
		}
		if o.Opcional {
			return nil
		}
	}
	if esta && v == nil && o.Nulo {
		return nil
	}
	if s, ok := v.(string); ok {
		for _, x := range valores {
			if s == x {
				return &s
			}
		}
	}
	if len(valores) == 1 {
		l.mal(campo, "Invalid input: expected "+strconv.Quote(valores[0]))
		return nil
	}
	comillas := make([]string, len(valores))
	for i, x := range valores {
		comillas[i] = strconv.Quote(x)
	}
	l.mal(campo, "Invalid option: expected one of "+strings.Join(comillas, "|"))
	return nil
}

// Opciones dice cómo es un z.enum().
type Opciones struct {
	Defecto        string
	Opcional, Nulo bool
}

// Lista es z.array(z.object(...)): cada elemento lo lee `cada`; después van
// los controles de largo (zod reporta primero los elementos). Devuelve el
// largo y si vino.
type Lista struct {
	Opcional bool
	Min      int
	MsjMin   string
	Max      int
}

// Objetos lee una lista de objetos.
func (l *Lector) Objetos(campo string, o Lista, cada func(i int, e *Lector)) (int, bool) {
	v, esta := l.m[campo]
	if !esta && o.Opcional {
		return 0, false
	}
	xs, es := v.([]any)
	if !es {
		l.mal(campo, "Invalid input: expected array, received "+TipoJS(v, esta))
		return 0, esta
	}
	for i, x := range xs {
		m, es := x.(map[string]any)
		if !es {
			l.mal(fmt.Sprintf("%s.%d", campo, i), "Invalid input: expected object, received "+TipoJS(x, true))
			continue
		}
		cada(i, l.hijo(fmt.Sprintf("%s%s.%d.", l.ruta, campo, i), m))
	}
	if o.Min > 0 && len(xs) < o.Min {
		m := o.MsjMin
		if m == "" {
			m = fmt.Sprintf("Too small: expected array to have >=%d items", o.Min)
		}
		l.mal(campo, m)
	}
	if o.Max > 0 && len(xs) > o.Max {
		l.mal(campo, fmt.Sprintf("Too big: expected array to have <=%d items", o.Max))
	}
	return len(xs), true
}

// Objeto es un z.object() anidado. Con `opcional`/`nulo`, nil si no vino o
// vino null.
func (l *Lector) Objeto(campo string, opcional, nulo bool) *Lector {
	v, esta := l.m[campo]
	if !esta && opcional {
		return nil
	}
	if esta && v == nil && nulo {
		return nil
	}
	m, es := v.(map[string]any)
	if !es {
		l.mal(campo, "Invalid input: expected object, received "+TipoJS(v, esta))
		return nil
	}
	return l.hijo(l.ruta+campo+".", m)
}

// --- de JS ---

// EspacioJS es lo que String.prototype.trim y \s de JS cuentan como espacio.
func EspacioJS(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// TrimJS es String.prototype.trim.
func TrimJS(s string) string { return strings.TrimFunc(s, EspacioJS) }

// LargoJS es .length: unidades UTF-16.
func LargoJS(s string) int {
	n := 0
	for _, r := range s {
		n += len(utf16.Encode([]rune{r}))
	}
	return n
}

// fechaHora es el regex de z.string().datetime() de zod 4.4 (sin offset ni
// hora local: solo Z).
var fechaHora = regexp.MustCompile(`^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$`)

// F es un puntero a un número (para los .default()).
func F(n float64) *float64 { return &n }

// S es un puntero a un texto.
func S(s string) *string { return &s }
