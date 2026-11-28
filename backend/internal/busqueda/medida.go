package busqueda

import (
	"regexp"
	"strings"
)

// reMedidaPorPor es una medida escrita de corrido: «2x4», «1x6».
var reMedidaPorPor = regexp.MustCompile(`^(\d{1,4})x(\d{1,4})$`)

// MedidaPorPor dice si el término es una medida escrita de corrido y
// devuelve la expresión de Postgres (para `~*`) que la encuentra escrita
// como se carga: «2" x 4"», «2x4». Ni antes ni después puede haber otra
// cifra o una barra: «2x4» no es el machimbre de 1/2" x 4" (mes 23: lo
// ponía primero en el presupuesto y en el bot).
func MedidaPorPor(termino string) (string, bool) {
	g := reMedidaPorPor.FindStringSubmatch(strings.ToLower(termino))
	if g == nil {
		return "", false
	}
	return `(^|[^0-9/.,])` + g[1] + `\W{0,3}x\W{0,3}` + g[2] + `([^0-9/.,]|$)`, true
}
