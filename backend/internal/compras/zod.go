package compras

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
)

// Lo que hacían los esquemas de zod de las acciones de compras, sobre el
// JSON tal como lo mandó el formulario (map[string]any): faltar, venir en
// null o venir con otro tipo son cosas distintas, y zod las distinguía.
//
// Como las acciones solo mostraban el primer problema (issues[0]), basta con
// recorrer los campos en el orden del esquema y quedarse con el primero: zod
// los reporta en ese orden. Un NaN de JS llega por JSON como null; en los
// campos numéricos null se lee como NaN.

// lector recorre un objeto y guarda el primer problema.
type lector struct {
	m      map[string]any
	ruta   string
	campo  string
	error  string
	padres *lector
}

func leer(m map[string]any) *lector { return &lector{m: m} }

func (l *lector) raiz() *lector {
	for l.padres != nil {
		l = l.padres
	}
	return l
}

func (l *lector) mal(campo, mensaje string) {
	r := l.raiz()
	if r.error != "" {
		return
	}
	r.campo, r.error = l.ruta+campo, mensaje
}

// Problema es el primero, listo para devolver (nil si no hubo).
func (l *lector) Problema() error {
	r := l.raiz()
	if r.error == "" {
		return nil
	}
	return plataforma.Invalido(map[string]string{r.campo: r.error})
}

func (l *lector) ok() bool { return l.raiz().error == "" }

func (l *lector) hijo(ruta string, m map[string]any) *lector {
	return &lector{m: m, ruta: ruta, padres: l}
}

// tipoJS es lo que zod dice que recibió.
func tipoJS(v any, esta bool) string {
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

// numeroJS es Number(v) de z.coerce.number().
func numeroJS(v any, esta bool) float64 {
	if !esta {
		return math.NaN()
	}
	switch x := v.(type) {
	case nil:
		return math.NaN() // el NaN de JS viaja como null
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

func textoNumero(n float64) string { return jsmath.Texto(n) }

// reglaNumero es un control de z.number() en el orden en que se escribió.
type reglaNumero struct {
	tipo    string // "int", ">", ">=", "<="
	limite  float64
	mensaje string
}

func entero() reglaNumero              { return reglaNumero{tipo: "int"} }
func positivo(m string) reglaNumero    { return reglaNumero{">", 0, m} }
func minimo(n float64) reglaNumero     { return reglaNumero{">=", n, ""} }
func maximo(n float64) reglaNumero     { return reglaNumero{"<=", n, ""} }
func minimoMsj(n float64, m string) reglaNumero { return reglaNumero{">=", n, m} }

// numero es z.coerce.number() con sus controles. `defecto` es el .default().
func (l *lector) numero(campo string, defecto *float64, reglas ...reglaNumero) float64 {
	v, esta := l.m[campo]
	if !esta && defecto != nil {
		return *defecto
	}
	n := numeroJS(v, esta)
	if math.IsNaN(n) {
		l.mal(campo, "Invalid input: expected number, received NaN")
		return n
	}
	if math.IsInf(n, 0) {
		l.mal(campo, "Invalid input: expected number, received number")
		return n
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
				mensaje = "Too small: expected number to be >" + textoNumero(r.limite)
			}
		case ">=":
			falla = !(n >= r.limite)
			if mensaje == "" {
				mensaje = "Too small: expected number to be >=" + textoNumero(r.limite)
			}
		case "<=":
			falla = !(n <= r.limite)
			if mensaje == "" {
				mensaje = "Too big: expected number to be <=" + textoNumero(r.limite)
			}
		}
		if falla {
			l.mal(campo, mensaje)
			return n
		}
	}
	return n
}

// opcionesTexto dicen cómo es un z.string().
type opcionesTexto struct {
	opcional, nulo, recortar bool
	min, max                 int
	msjMin, msjUUID          string
	uuid                     bool
}

// texto es z.string() con .trim(), .min(), .max() y .uuid(). Devuelve el
// valor y si estaba (undefined es "no estaba"; null, si se admite, es nil).
func (l *lector) texto(campo string, o opcionesTexto) (*string, bool) {
	v, esta := l.m[campo]
	if !esta && o.opcional {
		return nil, false
	}
	if esta && v == nil && o.nulo {
		return nil, true
	}
	s, es := v.(string)
	if !es {
		l.mal(campo, "Invalid input: expected string, received "+tipoJS(v, esta))
		return nil, esta
	}
	if o.recortar {
		s = trimJS(s)
	}
	if o.min > 0 && plataforma.LargoJS(s) < o.min {
		m := o.msjMin
		if m == "" {
			m = fmt.Sprintf("Too small: expected string to have >=%d characters", o.min)
		}
		l.mal(campo, m)
		return &s, true
	}
	if o.max > 0 && plataforma.LargoJS(s) > o.max {
		l.mal(campo, fmt.Sprintf("Too big: expected string to have <=%d characters", o.max))
		return &s, true
	}
	if o.uuid && !plataforma.UUIDValido(s) {
		m := o.msjUUID
		if m == "" {
			m = "Invalid UUID"
		}
		l.mal(campo, m)
	}
	return &s, true
}

// requerido es un z.string() obligatorio, como texto.
func (l *lector) requerido(campo string, o opcionesTexto) string {
	s, _ := l.texto(campo, o)
	if s == nil {
		return ""
	}
	return *s
}

// opcionalONulo es el `.optional().transform((v) => (v ? v : null))`: lo
// vacío o ausente queda en nil.
func (l *lector) opcionalONulo(campo string, max int) *string {
	s, _ := l.texto(campo, opcionesTexto{opcional: true, recortar: true, max: max})
	if s == nil || *s == "" {
		return nil
	}
	return s
}

func (l *lector) uuid(campo, mensaje string) string {
	return l.requerido(campo, opcionesTexto{uuid: true, msjUUID: mensaje})
}

// opcion es z.enum([...]) (con .default si `defecto` no es "").
func (l *lector) opcion(campo, defecto string, valores ...string) string {
	v, esta := l.m[campo]
	if !esta && defecto != "" {
		return defecto
	}
	if s, ok := v.(string); ok {
		for _, x := range valores {
			if s == x {
				return s
			}
		}
	}
	comillas := make([]string, len(valores))
	for i, x := range valores {
		comillas[i] = strconv.Quote(x)
	}
	l.mal(campo, "Invalid option: expected one of "+strings.Join(comillas, "|"))
	return ""
}

// lista es z.array(...): cada elemento es un objeto que lee `cada`, y
// después los controles de largo (zod reporta primero los elementos).
func (l *lector) lista(campo string, opcional bool, min int, msjMin string, max int, cada func(i int, e *lector)) (int, bool) {
	v, esta := l.m[campo]
	if !esta && opcional {
		return 0, false
	}
	xs, es := v.([]any)
	if !es {
		l.mal(campo, "Invalid input: expected array, received "+tipoJS(v, esta))
		return 0, esta
	}
	for i, x := range xs {
		m, es := x.(map[string]any)
		if !es {
			l.mal(fmt.Sprintf("%s.%d", campo, i), "Invalid input: expected object, received "+tipoJS(x, true))
			continue
		}
		cada(i, l.hijo(fmt.Sprintf("%s%s.%d.", l.ruta, campo, i), m))
	}
	if min > 0 && len(xs) < min {
		m := msjMin
		if m == "" {
			m = fmt.Sprintf("Too small: expected array to have >=%d items", min)
		}
		l.mal(campo, m)
	}
	if max > 0 && len(xs) > max {
		l.mal(campo, fmt.Sprintf("Too big: expected array to have <=%d items", max))
	}
	return len(xs), true
}

// objeto es un z.object() anidado .nullable().optional(): nil si no vino.
func (l *lector) objeto(campo string) (*lector, bool) {
	v, esta := l.m[campo]
	if !esta || v == nil {
		return nil, false
	}
	m, es := v.(map[string]any)
	if !es {
		l.mal(campo, "Invalid input: expected object, received "+tipoJS(v, true))
		return nil, false
	}
	return l.hijo(l.ruta+campo+".", m), true
}

// fecha es z.coerce.date(): new Date(v).
func (l *lector) fecha(campo string) time.Time {
	v, esta := l.m[campo]
	if s, es := v.(string); es && esta {
		if f, ok := LeerFecha(s); ok {
			return f
		}
	}
	l.mal(campo, "Invalid input: expected date, received Date")
	return time.Time{}
}

func f(n float64) *float64 { return &n }
