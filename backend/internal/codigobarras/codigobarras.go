// Package codigobarras arma los códigos de barras de las etiquetas: EAN-13
// cuando el código de la medida es un EAN válido (el que trae el proveedor
// en la caja), y Code 128 para todo lo demás (los SKU propios).
//
// Devuelve los módulos como texto («1» barra, «0» espacio) y el dibujo lo
// hace quien imprime, con un SVG de rectángulos. Así no hace falta una
// librería ni una fuente de código de barras, y la misma salida sirve para la
// hoja A4 y para el rollo.
package codigobarras

import (
	"errors"
	"strings"
)

// Tipo es la simbología.
type Tipo string

const (
	EAN13   Tipo = "ean13"
	Code128 Tipo = "code128"
)

// Barras es un código listo para dibujar. Los módulos no incluyen la zona de
// silencio: el dibujo deja el margen.
type Barras struct {
	Tipo    Tipo   `json:"tipo"`
	Modulos string `json:"modulos"`
}

// ErrNoCodificable es un texto que Code 128 B no admite (letras con tilde,
// eñes, emojis): sin barras, la etiqueta muestra solo el código.
var ErrNoCodificable = errors.New("el código tiene caracteres que no van en un código de barras")

// Armar elige la simbología y arma el código.
func Armar(codigo string) (Barras, error) {
	codigo = strings.TrimSpace(codigo)
	if EANValido(codigo) {
		return Barras{EAN13, ean13(codigo)}, nil
	}
	m, err := code128(codigo)
	if err != nil {
		return Barras{}, err
	}
	return Barras{Code128, m}, nil
}

// --- EAN-13 ---

// DigitoVerificador es el del EAN-13 sobre los primeros doce dígitos: pesos
// 1 y 3 alternados desde la izquierda.
func DigitoVerificador(doce string) byte {
	suma := 0
	for i := 0; i < 12; i++ {
		d := int(doce[i] - '0')
		if i%2 == 1 {
			d *= 3
		}
		suma += d
	}
	return byte('0' + (10-suma%10)%10)
}

// EANValido: trece dígitos y el último es el verificador.
func EANValido(s string) bool {
	if len(s) != 13 {
		return false
	}
	for i := 0; i < 13; i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return DigitoVerificador(s[:12]) == s[12]
}

// Las codificaciones L de cada dígito. Las G son las R al revés y las R, las
// L invertidas: se derivan para no tener tres tablas que se puedan desfasar.
var eanL = [10]string{"0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"}

// La paridad de los seis dígitos de la izquierda según el primero.
var eanParidad = [10]string{"LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"}

func invertir(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c == '0' {
			b[i] = '1'
		} else {
			b[i] = '0'
		}
	}
	return string(b)
}

func alReves(s string) string {
	b := []byte(s)
	for i, j := 0, len(b)-1; i < j; i, j = i+1, j-1 {
		b[i], b[j] = b[j], b[i]
	}
	return string(b)
}

func eanR(d byte) string { return invertir(eanL[d-'0']) }
func eanG(d byte) string { return alReves(eanR(d)) }

// ean13 son los 95 módulos de un EAN-13 ya validado.
func ean13(s string) string {
	var b strings.Builder
	b.WriteString("101")
	paridad := eanParidad[s[0]-'0']
	for i := 1; i <= 6; i++ {
		if paridad[i-1] == 'L' {
			b.WriteString(eanL[s[i]-'0'])
		} else {
			b.WriteString(eanG(s[i]))
		}
	}
	b.WriteString("01010")
	for i := 7; i <= 12; i++ {
		b.WriteString(eanR(s[i]))
	}
	b.WriteString("101")
	return b.String()
}

// --- Code 128 ---

// code128Anchos son los 107 símbolos como anchos de barra y espacio
// alternados, empezando por barra: 0–102 los valores, 103–105 los inicios A,
// B y C, 106 la parada (con su barra final de 2).
var code128Anchos = [107]string{
	"212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
	"221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
	"221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
	"212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
	"231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
	"231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
	"314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
	"112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
	"111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
	"214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
	"114131", "311141", "411131", "211412", "211214", "211232", "2331112",
}

const (
	inicioB = 104
	inicioC = 105
	parada  = 106
)

func simbolo(v int) string {
	var b strings.Builder
	for i, c := range code128Anchos[v] {
		m := "1"
		if i%2 == 1 {
			m = "0"
		}
		b.WriteString(strings.Repeat(m, int(c-'0')))
	}
	return b.String()
}

// soloDigitos: el juego C codifica dos dígitos por símbolo, y un código
// numérico par sale la mitad de ancho, que en una etiqueta de 50 mm importa.
func soloDigitos(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return len(s) > 0
}

// valores128 son los valores de datos y el inicio: juego C si son dígitos en
// cantidad par (cuatro o más), si no juego B (ASCII imprimible).
func valores128(s string) (inicio int, valores []int, err error) {
	if s == "" {
		return 0, nil, ErrNoCodificable
	}
	if len(s) >= 4 && len(s)%2 == 0 && soloDigitos(s) {
		for i := 0; i < len(s); i += 2 {
			valores = append(valores, int(s[i]-'0')*10+int(s[i+1]-'0'))
		}
		return inicioC, valores, nil
	}
	for _, r := range s {
		if r < 32 || r > 126 {
			return 0, nil, ErrNoCodificable
		}
		valores = append(valores, int(r)-32)
	}
	return inicioB, valores, nil
}

func code128(s string) (string, error) {
	inicio, valores, err := valores128(s)
	if err != nil {
		return "", err
	}
	suma := inicio
	for i, v := range valores {
		suma += (i + 1) * v
	}
	var b strings.Builder
	b.WriteString(simbolo(inicio))
	for _, v := range valores {
		b.WriteString(simbolo(v))
	}
	b.WriteString(simbolo(suma % 103))
	b.WriteString(simbolo(parada))
	return b.String(), nil
}
