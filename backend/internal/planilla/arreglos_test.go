package planilla

import "testing"

// Los dos arreglos de la tanda 13 (la migración de ISIS), dichos a mano además
// del golden: el TS de antes daba otra cosa.
func TestArreglosDeLaTanda13(t *testing.T) {
	// Excel: el 3/9/2026 es el serie 46268 (días desde el 30/12/1899). El TS
	// daba el 2/9: todas las fechas de un .xlsx, un día antes.
	for serie, esperado := range map[float64]string{
		46268:   "2026-09-03T00:00:00.000Z",
		45351:   "2024-02-29T00:00:00.000Z",
		61:      "1900-03-01T00:00:00.000Z",
		1:       "1900-01-01T00:00:00.000Z",
		46268.5: "2026-09-03T12:00:00.000Z",
	} {
		if got, err := fechaDeSerie(serie); err != nil || got != esperado {
			t.Errorf("fechaDeSerie(%v) = %q, %v; se esperaba %q", serie, got, err, esperado)
		}
	}

	// "1,234" son miles; "0,125" no puede ser ciento veinticinco (el TS lo
	// leía así).
	for texto, esperado := range map[string]string{
		"1,234": "1234.00", "96.500": "96500.00", "0,125": "0.13", "0.125": "0.13", ",125": "0.13", "-0,125": "-0.13",
	} {
		if got, ok := InterpretarNumero(texto); !ok || got != esperado {
			t.Errorf("InterpretarNumero(%q) = %q; se esperaba %q", texto, got, esperado)
		}
	}
}
