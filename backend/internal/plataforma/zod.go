package plataforma

import (
	"regexp"
	"unicode/utf16"
)

// Lo que validaban los esquemas de zod de Next, para que Go acepte y rechace
// exactamente lo mismo.

var uuidZod = regexp.MustCompile(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`)

// UUIDValido es z.string().uuid() de zod 4.
func UUIDValido(s string) bool { return uuidZod.MatchString(s) }

// LargoJS es .length de un texto en JavaScript: unidades UTF-16, no runas
// (un emoji cuenta 2). Los .min() y .max() de zod cuentan así.
func LargoJS(s string) int {
	n := 0
	for _, r := range s {
		n += len(utf16.Encode([]rune{r}))
	}
	return n
}
