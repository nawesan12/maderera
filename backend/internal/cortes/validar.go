package cortes

// Lo que hacían los esquemas de zod de las acciones de cortes: z.coerce
// (Number() de JS) y los mensajes por omisión de zod 4, para que el primer
// error que ve la pantalla sea el mismo.

import (
	"encoding/json"
	"math"
	"strings"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
)

// numeroJS es Number(v) de JavaScript sobre un valor que llegó en JSON;
// ausente es NaN (Number(undefined)).
func numeroJS(v any, presente bool) float64 {
	if !presente {
		return math.NaN()
	}
	switch x := v.(type) {
	case nil:
		return 0
	case bool:
		if x {
			return 1
		}
		return 0
	case float64:
		return x
	case string:
		return jsmath.Numero(x)
	}
	return math.NaN()
}

// reglaNumero son las restricciones de un z.coerce.number().
type reglaNumero struct {
	entero      bool
	positivo    bool
	min, max    *float64
	msgMin      string
	msgMax      string
	msgPositivo string
}

func pf(x float64) *float64 { return &x }

// validarNumero devuelve el primer mensaje de zod, o "".
func validarNumero(n float64, r reglaNumero) string {
	if math.IsNaN(n) {
		return "Invalid input: expected number, received NaN"
	}
	if r.entero && (n != math.Trunc(n) || math.IsInf(n, 0)) {
		return "Invalid input: expected int, received number"
	}
	if r.positivo && n <= 0 {
		if r.msgPositivo != "" {
			return r.msgPositivo
		}
		return "Too small: expected number to be >0"
	}
	if r.min != nil && n < *r.min {
		if r.msgMin != "" {
			return r.msgMin
		}
		return "Too small: expected number to be >=" + jsmath.Texto(*r.min)
	}
	if r.max != nil && n > *r.max {
		if r.msgMax != "" {
			return r.msgMax
		}
		return "Too big: expected number to be <=" + jsmath.Texto(*r.max)
	}
	return ""
}

// largoJS es String.length (en unidades UTF-16).
func largoJS(s string) int { return plataforma.LargoJS(s) }

// validarTexto es z.string().trim().min().max(): devuelve el texto
// recortado y el primer mensaje.
func validarTexto(s string, min int, msgMin string, max int) (string, string) {
	t := strings.TrimSpace(s)
	if largoJS(t) < min {
		if msgMin != "" {
			return t, msgMin
		}
		return t, "Too small: expected string to have >=" + jsmath.Texto(float64(min)) + " characters"
	}
	if max > 0 && largoJS(t) > max {
		return t, "Too big: expected string to have <=" + jsmath.Texto(float64(max)) + " characters"
	}
	return t, ""
}

func jsonSinEscapar(v any) (string, error) {
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return "", err
	}
	return strings.TrimSuffix(b.String(), "\n"), nil
}
