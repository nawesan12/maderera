package jsmath

import (
	"database/sql/driver"
	"fmt"
	"strconv"
)

// Num es un `numeric` de Postgres leído como lo leía la aplicación en
// TypeScript: drizzle lo traía como texto y el código lo pasaba por
// `Number(...)`. ParseFloat redondea el texto al float64 más cercano, igual
// que Number (ver jsmath_test.go). Así un importe guardado por el sistema
// viejo da el mismo float en los dos lados.
//
// En JSON sale como número.
type Num float64

// Scan lee el numeric. pgx lo entrega como texto cuando el destino es un
// sql.Scanner, que es justo lo que se quiere: nada de pasar por una
// conversión binaria intermedia.
func (n *Num) Scan(src any) error {
	switch v := src.(type) {
	case string:
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return fmt.Errorf("numeric %q: %w", v, err)
		}
		*n = Num(f)
	case []byte:
		return n.Scan(string(v))
	case float64:
		*n = Num(v)
	case int64:
		*n = Num(v)
	case nil:
		return fmt.Errorf("numeric nulo en un campo que no lo admite (usá *jsmath.Num)")
	default:
		return fmt.Errorf("numeric: tipo inesperado %T", src)
	}
	return nil
}

// Value lo escribe como texto, para que Postgres lo convierta a numeric sin
// perder nada en el camino.
func (n Num) Value() (driver.Value, error) {
	return strconv.FormatFloat(float64(n), 'f', -1, 64), nil
}

// F es el float64, para las cuentas.
func (n Num) F() float64 { return float64(n) }
