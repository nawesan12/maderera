package pdf

import (
	"math"
	"testing"
	"time"
)

// Contra Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }) de Node
// 26 (con y sin useGrouping), sacado a mano: los empates ,25 y ,75 van hacia
// afuera, y el -0 conserva el signo.
func TestIntlUnDecimal(t *testing.T) {
	for _, c := range []struct {
		v              float64
		agrupado, solo string
	}{
		{0, "0", "0"},
		{math.Copysign(0, -1), "-0", "-0"},
		{4.4, "4,4", "4,4"},
		{1160, "1.160", "1160"},
		{12345.65, "12.345,7", "12345,7"},
		{0.25, "0,3", "0,3"},
		{0.75, "0,8", "0,8"},
		{-0.04, "-0", "-0"},
		{999.95, "1.000", "1000"},
		{2.25, "2,3", "2,3"},
		{-2.25, "-2,3", "-2,3"},
		{1e21, "1.000.000.000.000.000.000.000", "1000000000000000000000"},
	} {
		if got := intlUnDecimal(c.v, true); got != c.agrupado {
			t.Errorf("intlUnDecimal(%v, true) = %q, Intl da %q", c.v, got, c.agrupado)
		}
		if got := intlUnDecimal(c.v, false); got != c.solo {
			t.Errorf("intlUnDecimal(%v, false) = %q, Intl da %q", c.v, got, c.solo)
		}
	}
}

// Bug del TS: recortar() mide la etiqueta cruda con pdf-lib, y un carácter
// fuera de WinAnsi (un emoji en el nombre de un producto) tira «WinAnsi
// cannot encode» y voltea la descarga del reporte entero. En Go sale.
func TestReporteDeVentasConEmoji(t *testing.T) {
	costo := 10.0
	pdf, err := ReporteDeVentas(DatosReporteVentas{
		Titulo:  "Por producto",
		Periodo: "marzo",
		Filas: []FilaDeReporte{{
			Etiqueta: "Tabla 😀 de pino con un nombre larguísimo que no entra en la columna del reporte de ventas",
			Cantidad: 3, Total: 100, NetoVenta: 82, Costo: &costo,
		}},
	}, time.Now())
	if err != nil || len(pdf) == 0 {
		t.Fatalf("el reporte con un emoji no salió: %v", err)
	}
}
