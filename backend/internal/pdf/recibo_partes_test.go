package pdf

import (
	"math"
	"strings"
	"testing"
)

// Moneda2 contra Node (toLocaleString de Intl; la tabla salió de correr el
// TS, los «$ » llevan espacio duro) e ImporteEnLetras, que se apartó de
// importeEnLetras de lib/cobros/partes.ts a propósito: los centavos son los
// mismos que imprime Moneda2 (el TS decía «con 100/100» para 999,995, que
// se imprime «$ 1.000,00») y desde mil millones ya no se pierden los
// millones.
func TestMoneda2YLetras(t *testing.T) {
	for _, c := range []struct {
		v             float64
		pesos, letras string
	}{
		{0, "$ 0,00", "cero con 00/100"},
		{math.Copysign(0, -1), "-$ 0,00", "cero con 00/100"},
		{0.005, "$ 0,01", "cero con 01/100"},
		{0.015, "$ 0,02", "cero con 02/100"},
		{0.025, "$ 0,03", "cero con 03/100"},
		{1.005, "$ 1,01", "uno con 01/100"},
		{2.675, "$ 2,68", "dos con 68/100"},
		{21021.995, "$ 21.022,00", "veintiún mil veintidós con 00/100"},
		{999.995, "$ 1.000,00", "mil con 00/100"},
		{9999999.995, "$ 10.000.000,00", "diez millones con 00/100"},
		{-0.004, "-$ 0,00", "cero con 00/100"},
		{-1234.565, "-$ 1.234,57", "mil doscientos treinta y cuatro con 57/100"},
		{1000000000000000.2, "$ 1.000.000.000.000.000,20", "mil billones con 20/100"},
		{123456789.125, "$ 123.456.789,13", "ciento veintitrés millones cuatrocientos cincuenta y seis mil setecientos ochenta y nueve con 13/100"},
		{0.30000000000000004, "$ 0,30", "cero con 30/100"},
		{1, "$ 1,00", "uno con 00/100"},
		{21, "$ 21,00", "veintiuno con 00/100"},
		{21000, "$ 21.000,00", "veintiún mil con 00/100"},
		{21021, "$ 21.021,00", "veintiún mil veintiuno con 00/100"},
		{100, "$ 100,00", "cien con 00/100"},
		{101, "$ 101,00", "ciento uno con 00/100"},
		{1000, "$ 1.000,00", "mil con 00/100"},
		{1001, "$ 1.001,00", "mil uno con 00/100"},
		{1000000, "$ 1.000.000,00", "un millón con 00/100"},
		{1000001, "$ 1.000.001,00", "un millón uno con 00/100"},
		{21000000, "$ 21.000.000,00", "veintiún millones con 00/100"},
		{31000000, "$ 31.000.000,00", "treinta y un millones con 00/100"},
		{999999999.99, "$ 999.999.999,99", "novecientos noventa y nueve millones novecientos noventa y nueve mil novecientos noventa y nueve con 99/100"},
		{1000000000, "$ 1.000.000.000,00", "mil millones con 00/100"},
		{1001000000, "$ 1.001.000.000,00", "mil un millones con 00/100"},
		{21000000000, "$ 21.000.000.000,00", "veintiún mil millones con 00/100"},
		{1000000000000, "$ 1.000.000.000.000,00", "un billón con 00/100"},
		{1234567890.5, "$ 1.234.567.890,50", "mil doscientos treinta y cuatro millones quinientos sesenta y siete mil ochocientos noventa con 50/100"},
		{71.71, "$ 71,71", "setenta y uno con 71/100"},
		{0.999999999, "$ 1,00", "uno con 00/100"},
		{30, "$ 30,00", "treinta con 00/100"},
		{31, "$ 31,00", "treinta y uno con 00/100"},
		{99, "$ 99,00", "noventa y nueve con 00/100"},
		{116, "$ 116,00", "ciento dieciséis con 00/100"},
		{200, "$ 200,00", "doscientos con 00/100"},
		{500000, "$ 500.000,00", "quinientos mil con 00/100"},
	} {
		quiero := strings.Replace(c.pesos, "$ ", "$ ", 1)
		if got := Moneda2(c.v); got != quiero {
			t.Errorf("Moneda2(%v) = %q, Intl da %q", c.v, got, quiero)
		}
		if got := ImporteEnLetras(c.v); got != c.letras {
			t.Errorf("ImporteEnLetras(%v) = %q, quiero %q", c.v, got, c.letras)
		}
	}
}
