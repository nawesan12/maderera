package jsmath

import (
	"math"
	"strconv"
	"strings"
)

// Numero es Number(texto) de JavaScript: recorta espacios, "" vale 0, acepta
// "1e3", ".5", "+5", los enteros 0x/0o/0b e "Infinity", y lo demás es NaN
// (Go aceptaría "inf", "nan" o "1_000"; JS no).
func Numero(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	switch s {
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if len(s) > 2 && s[0] == '0' {
		base := 0
		switch s[1] {
		case 'x', 'X':
			base = 16
		case 'o', 'O':
			base = 8
		case 'b', 'B':
			base = 2
		}
		if base != 0 {
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil || strings.Contains(s[2:], "_") {
				return math.NaN()
			}
			return float64(n)
		}
	}
	for _, r := range s {
		if !(r >= '0' && r <= '9' || r == '.' || r == 'e' || r == 'E' || r == '+' || r == '-') {
			return math.NaN()
		}
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		// ParseFloat da error de rango para 1e999, que en JS es Infinity.
		if ne, ok := err.(*strconv.NumError); ok && ne.Err == strconv.ErrRange {
			return n
		}
		return math.NaN()
	}
	return n
}
