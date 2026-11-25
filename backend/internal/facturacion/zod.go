package facturacion

import (
	"math"
	"regexp"
	"strings"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
)

// Los esquemas de zod de app/admin/facturacion/actions.ts, sobre los campos
// del formulario tal como llegan (map[string]string: un campo que no vino es
// el null de formData.get). Las acciones mostraban solo issues[0], así que
// alcanza con recorrer los campos en el orden del esquema y quedarse con el
// primer problema. Golden: scripts/golden/fiscal.ts (zod.json).

// valor es lo que zod recibe en un campo: un texto, null o undefined.
type valor struct {
	s          string
	nulo, nada bool
}

func texto(s string) valor { return valor{s: s} }

// get es formData.get(k): el texto o null.
func get(c map[string]string, k string) valor {
	if v, ok := c[k]; ok {
		return valor{s: v}
	}
	return valor{nulo: true}
}

// vacioAUndef es `(formData.get(k) as string) || undefined`.
func vacioAUndef(c map[string]string, k string) valor {
	if v, ok := c[k]; ok && v != "" {
		return valor{s: v}
	}
	return valor{nada: true}
}

func (v valor) recibido() string {
	switch {
	case v.nada:
		return "undefined"
	case v.nulo:
		return "null"
	}
	return "string"
}

// esquema junta el primer error.
type esquema struct {
	campo, error string
}

func (e *esquema) mal(campo, m string) {
	if e.error == "" {
		e.campo, e.error = campo, m
	}
}

func (e *esquema) ok() bool { return e.error == "" }

// Problema es el 422 con el primer error, o nil.
func (e *esquema) Problema() error {
	if e.error == "" {
		return nil
	}
	return plataforma.Invalido(map[string]string{e.campo: e.error})
}

func demasiadoLargo(n int) string {
	return "Too big: expected string to have <=" + jsmath.Texto(float64(n)) + " characters"
}

func demasiadoCorto(n int) string {
	return "Too small: expected string to have >=" + jsmath.Texto(float64(n)) + " characters"
}

// cadena es z.string().trim() con min (y su mensaje) y max. opcional:
// undefined pasa. Devuelve el texto recortado.
func (e *esquema) cadena(campo string, v valor, opcional bool, min int, msjMin string, max int) (string, bool) {
	if v.nada && opcional {
		return "", false
	}
	if v.nada || v.nulo {
		e.mal(campo, "Invalid input: expected string, received "+v.recibido())
		return "", false
	}
	t := strings.TrimSpace(v.s)
	n := plataforma.LargoJS(t)
	if min > 0 && n < min {
		if msjMin == "" {
			msjMin = demasiadoCorto(min)
		}
		e.mal(campo, msjMin)
	} else if max > 0 && n > max {
		e.mal(campo, demasiadoLargo(max))
	}
	return t, true
}

// opcion es z.enum(...).
func (e *esquema) opcion(campo string, v valor, opciones []string) string {
	if !v.nulo && !v.nada {
		for _, o := range opciones {
			if v.s == o {
				return o
			}
		}
	}
	e.mal(campo, `Invalid option: expected one of "`+strings.Join(opciones, `"|"`)+`"`)
	return ""
}

// uuid es z.string().uuid() (opcional: undefined pasa).
func (e *esquema) uuid(campo string, v valor, opcional bool) string {
	if v.nada && opcional {
		return ""
	}
	if v.nada || v.nulo {
		e.mal(campo, "Invalid input: expected string, received "+v.recibido())
		return ""
	}
	if !plataforma.UUIDValido(v.s) {
		e.mal(campo, "Invalid UUID")
		return ""
	}
	return v.s
}

// numeroJS es Number(v) de z.coerce.number(): null es 0, undefined NaN.
func numeroJS(v valor) float64 {
	switch {
	case v.nada:
		return math.NaN()
	case v.nulo:
		return 0
	}
	return jsmath.Numero(v.s)
}

// entero es z.coerce.number().int().min(min).max(max).
func (e *esquema) entero(campo string, v valor, min, max float64) float64 {
	n := numeroJS(v)
	switch {
	case math.IsNaN(n):
		e.mal(campo, "Invalid input: expected number, received NaN")
	case math.IsInf(n, 0):
		e.mal(campo, "Invalid input: expected number, received number")
	case n != math.Trunc(n):
		e.mal(campo, "Invalid input: expected int, received number")
	case n < min:
		e.mal(campo, "Too small: expected number to be >="+jsmath.Texto(min))
	case n > max:
		e.mal(campo, "Too big: expected number to be <="+jsmath.Texto(max))
	}
	return n
}

// positivo es z.coerce.number().positive().max(max): devuelve si pasó.
func positivo(v valor, max float64) (float64, bool) {
	n := numeroJS(v)
	if math.IsNaN(n) || math.IsInf(n, 0) || n <= 0 || n > max {
		return n, false
	}
	return n, true
}

var cuitZod = regexp.MustCompile(`^\d{2}-?\d{8}-?\d$`)
