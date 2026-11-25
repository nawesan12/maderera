package plataforma

import (
	"regexp"
	"strings"
)

// La regla de z.string().email() de zod 4 (v4/core/regexes.js), sin los
// lookahead que RE2 no tiene: esos dos van aparte.
var correoZod = regexp.MustCompile(`^([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)

// CorreoValido acepta lo mismo que los formularios de Next validaban con zod.
func CorreoValido(c string) bool {
	return !strings.HasPrefix(c, ".") && !strings.Contains(c, "..") && correoZod.MatchString(c)
}
