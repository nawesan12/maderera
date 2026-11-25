package jsmath

import (
	"math"
	"math/big"
	"strings"
)

// ToFixed es Number.prototype.toFixed(d) de JavaScript (ECMA-262 21.1.3.3):
// el entero n más cercano a x·10^d **sobre el valor exacto del double**, y si
// hay dos, el más grande (sobre la magnitud: el signo va aparte). FormatFloat
// de Go redondea al par en el empate: 0.125 da «0.12» en Go y «0.13» en JS.
// Desde 1e21 es String(x), como en JS.
func ToFixed(x float64, d int) string {
	if math.IsNaN(x) {
		return "NaN"
	}
	signo := ""
	if x < 0 {
		signo, x = "-", -x
	}
	if x >= 1e21 || math.IsInf(x, 0) {
		return signo + Texto(x)
	}
	// x·10^d exacto: los dos son finitos en binario y en decimal, así que con
	// precisión de sobra el producto no pierde nada.
	escala := new(big.Float).SetPrec(2000).SetFloat64(math.Pow10(d))
	if d > 22 { // 10^d deja de ser exacto en float64
		escala.SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(d)), nil))
	}
	exacto := new(big.Float).SetPrec(2000).SetFloat64(x)
	exacto.Mul(exacto, escala)
	n, _ := exacto.Int(nil) // trunca
	resto := new(big.Float).SetPrec(2000).Sub(exacto, new(big.Float).SetInt(n))
	if resto.Cmp(big.NewFloat(0.5)) >= 0 {
		n.Add(n, big.NewInt(1))
	}
	digitos := n.String()
	if d == 0 {
		return signo + digitos
	}
	if len(digitos) <= d {
		digitos = strings.Repeat("0", d-len(digitos)+1) + digitos
	}
	t := digitos[:len(digitos)-d] + "." + digitos[len(digitos)-d:]
	if signo == "-" && strings.Trim(t, "0.") == "" {
		// (-0.001).toFixed(2) es "-0.00" en JS: el signo se queda.
		return "-" + t
	}
	return signo + t
}

// Fijo2 es toFixed(2), lo que va a las columnas numeric(…, 2).
func Fijo2(x float64) string { return ToFixed(x, 2) }
