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

// M2S1-044: una celda de precio mala marca la fila y dice cuál; la vacía no
// cambia nada; «12,345» no se adivina.
func TestCeldaDePrecioMala(t *testing.T) {
	grilla := [][]string{
		{"SKU", "Producto", "Precio lista", "Precio profesional"},
		{"A", "x", "abc", "20000"},
		{"B", "x", "-100", ""},
		{"C", "x", "30000", "xyz"},
		{"D", "x", "12,345", ""},
		{"E", "x", "49800", ""},
		{"F", "x", "96.500", "84500,50"},
		{"G", "x", "12,3456", ""},
	}
	f := LeerFilas(grilla)
	esperado := []string{
		"Precio de lista: «abc» no es un precio.",
		"Precio de lista: «-100» no es un precio.",
		"Precio profesional: «xyz» no es un precio.",
		"Precio de lista: «12,345» tiene más de dos decimales.",
		"",
		"",
		"Precio de lista: «12,3456» tiene más de dos decimales.",
	}
	for i, e := range esperado {
		if f[i].Error != e {
			t.Errorf("fila %s: error %q; se esperaba %q", f[i].Sku, f[i].Error, e)
		}
	}
	if f[4].PrecioGeneral == nil || *f[4].PrecioGeneral != "49800.00" || f[4].PrecioProfesional != nil {
		t.Errorf("E: %+v", f[4])
	}
	if f[5].PrecioGeneral == nil || *f[5].PrecioGeneral != "96500.00" || *f[5].PrecioProfesional != "84500.50" {
		t.Errorf("F: %+v", f[5])
	}
}
