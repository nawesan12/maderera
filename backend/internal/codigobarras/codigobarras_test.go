package codigobarras

import (
	"strings"
	"testing"
)

// La tabla de Code 128 copiada a mano es lo más fácil de arruinar con un
// dígito. Estas propiedades las cumple la tabla del estándar y casi cualquier
// error de tipeo rompe alguna: cada símbolo mide 11 módulos (la parada, 13),
// los anchos van de 1 a 4, las barras suman par y no hay dos iguales.
func TestTablaCode128(t *testing.T) {
	vistos := map[string]int{}
	for v, a := range code128Anchos {
		largo, barras := 0, 0
		for i, c := range a {
			n := int(c - '0')
			if n < 1 || n > 4 {
				t.Errorf("símbolo %d: ancho %d", v, n)
			}
			largo += n
			if i%2 == 0 {
				barras += n
			}
		}
		quiero := 11
		if v == parada {
			quiero = 13
		}
		if largo != quiero {
			t.Errorf("símbolo %d mide %d módulos", v, largo)
		}
		if barras%2 != 0 {
			t.Errorf("símbolo %d: las barras suman impar", v)
		}
		if otro, ok := vistos[a]; ok {
			t.Errorf("símbolos %d y %d iguales", otro, v)
		}
		vistos[a] = v
	}
}

// leer128 decodifica los módulos con la tabla al revés y verifica el dígito
// de control: lo que se arma se tiene que poder leer.
func leer128(t *testing.T, m string) string {
	t.Helper()
	por := map[string]int{}
	for v := range code128Anchos {
		por[simbolo(v)] = v
	}
	if !strings.HasSuffix(m, simbolo(parada)) {
		t.Fatalf("sin parada: %s", m)
	}
	m = strings.TrimSuffix(m, simbolo(parada))
	if len(m)%11 != 0 {
		t.Fatalf("largo %d no es múltiplo de 11", len(m))
	}
	var vs []int
	for i := 0; i < len(m); i += 11 {
		v, ok := por[m[i:i+11]]
		if !ok {
			t.Fatalf("símbolo desconocido en %d", i)
		}
		vs = append(vs, v)
	}
	suma := vs[0]
	for i, v := range vs[1 : len(vs)-1] {
		suma += (i + 1) * v
	}
	if suma%103 != vs[len(vs)-1] {
		t.Fatalf("control %d, quiero %d", vs[len(vs)-1], suma%103)
	}
	var b strings.Builder
	for _, v := range vs[1 : len(vs)-1] {
		switch vs[0] {
		case inicioB:
			b.WriteByte(byte(v + 32))
		case inicioC:
			b.WriteByte(byte('0' + v/10))
			b.WriteByte(byte('0' + v%10))
		}
	}
	return b.String()
}

func TestCode128IdaYVuelta(t *testing.T) {
	for _, c := range []string{"CSE-LAN-050", "FEN18", "x", "1234", "123", "00112233", "A b ~ {}", "7790001"} {
		b, err := Armar(c)
		if err != nil {
			t.Fatalf("%q: %v", c, err)
		}
		if b.Tipo != Code128 {
			t.Errorf("%q salió %s", c, b.Tipo)
		}
		if got := leer128(t, b.Modulos); got != c {
			t.Errorf("%q se lee %q", c, got)
		}
	}
	// Dígitos pares: juego C, la mitad de símbolos.
	b, _ := Armar("12345678")
	if !strings.HasPrefix(b.Modulos, simbolo(inicioC)) || len(b.Modulos) != 11*(1+4+1)+13 {
		t.Errorf("12345678 no fue por el juego C: %d módulos", len(b.Modulos))
	}
}

// El control calculado aparte, con los valores escritos a mano (P=48, J=42,
// 1=17, 2=18, 3=19, C=35 en el juego B), para no depender de la misma función.
func TestCode128ControlAMano(t *testing.T) {
	vals := []int{48, 42, 42, 17, 18, 19, 35}
	suma := 104
	for i, v := range vals {
		suma += (i + 1) * v
	}
	_, got, _ := valores128("PJJ123C")
	for i := range vals {
		if got[i] != vals[i] {
			t.Fatalf("valores %v, quiero %v", got, vals)
		}
	}
	b, _ := Armar("PJJ123C")
	fin := strings.TrimSuffix(b.Modulos, simbolo(parada))
	if fin[len(fin)-11:] != simbolo(suma%103) {
		t.Errorf("control mal")
	}
}

func TestNoCodificable(t *testing.T) {
	for _, c := range []string{"", "Ñandú-12", "café"} {
		if _, err := Armar(c); err == nil {
			t.Errorf("%q se codificó", c)
		}
	}
}

func TestEAN13(t *testing.T) {
	// Ejemplos públicos con su verificador: el de la Wikipedia y uno argentino.
	for _, c := range []string{"4006381333931", "5901234123457", "7790070012050"} {
		if !EANValido(c) {
			t.Errorf("%s debería ser válido", c)
		}
	}
	for _, c := range []string{"4006381333932", "400638133393", "40063813339311", "400638133393a"} {
		if EANValido(c) {
			t.Errorf("%s no debería ser válido", c)
		}
	}
	b, err := Armar("4006381333931")
	if err != nil || b.Tipo != EAN13 || len(b.Modulos) != 95 {
		t.Fatalf("%+v %v", b, err)
	}
	// Guardas en su lugar.
	if b.Modulos[:3] != "101" || b.Modulos[45:50] != "01010" || b.Modulos[92:] != "101" {
		t.Errorf("guardas: %s", b.Modulos)
	}
	// Leerlo de vuelta: la paridad de la izquierda da el primer dígito.
	if got := leerEAN(t, b.Modulos); got != "4006381333931" {
		t.Errorf("se lee %s", got)
	}
	// Un EAN con verificador malo va por Code 128, no se dibuja un EAN falso.
	if b, _ := Armar("4006381333932"); b.Tipo != Code128 {
		t.Errorf("verificador malo salió %s", b.Tipo)
	}
}

// Las codificaciones G y R se derivan de L; acá se comparan con las del
// estándar escritas aparte, para que la derivación no esconda un error.
func TestEANTablasDerivadas(t *testing.T) {
	g := []string{"0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"}
	r := []string{"1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"}
	for d := byte('0'); d <= '9'; d++ {
		if eanG(d) != g[d-'0'] || eanR(d) != r[d-'0'] {
			t.Errorf("dígito %c: G %s R %s", d, eanG(d), eanR(d))
		}
	}
}

func leerEAN(t *testing.T, m string) string {
	t.Helper()
	l, gg, rr := map[string]byte{}, map[string]byte{}, map[string]byte{}
	for d := byte('0'); d <= '9'; d++ {
		l[eanL[d-'0']], gg[eanG(d)], rr[eanR(d)] = d, d, d
	}
	var izq []byte
	var paridad string
	for i := 0; i < 6; i++ {
		s := m[3+7*i : 10+7*i]
		if d, ok := l[s]; ok {
			izq, paridad = append(izq, d), paridad+"L"
		} else if d, ok := gg[s]; ok {
			izq, paridad = append(izq, d), paridad+"G"
		} else {
			t.Fatalf("símbolo izquierdo %d desconocido", i)
		}
	}
	primero := byte(0)
	for d, p := range eanParidad {
		if p == paridad {
			primero = byte('0' + d)
		}
	}
	out := []byte{primero}
	out = append(out, izq...)
	for i := 0; i < 6; i++ {
		s := m[50+7*i : 57+7*i]
		d, ok := rr[s]
		if !ok {
			t.Fatalf("símbolo derecho %d desconocido", i)
		}
		out = append(out, d)
	}
	return string(out)
}
