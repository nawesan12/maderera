package fiscal

import "testing"

// Las notas de crédito cierran el original al centavo (revisión del comité,
// T6): el unitario redondeado por la cantidad dejaba la factura acreditada
// por 99,99 de 100 y nunca se cerraba.

func tresPorCien(acreditado, importe float64) []ItemOriginal {
	return []ItemOriginal{{ID: "a", Descripcion: "Placa", Unidad: "unidad", Cantidad: 3, Subtotal: 100, AlicuotaIva: 21,
		Acreditado: acreditado, AcreditadoImporte: importe}}
}

func TestNotaEnteraDevuelveElSubtotal(t *testing.T) {
	o := Original{Neto: 82.64, Iva21: 17.36, Total: 100}
	c := CalcularNota(o, tresPorCien(0, 0), []CantidadAAcreditar{{"a", 3}}, nil)
	if c.Problema != "" || c.Total != 100 {
		t.Fatalf("la nota por las 3 da %v (%q), quería 100", c.Total, c.Problema)
	}
	c = CalcularNota(o, tresPorCien(0, 0), nil, nil)
	if c.Total != 100 {
		t.Fatalf("la nota por el total da %v, quería 100", c.Total)
	}
}

func TestDosParcialesSumanElOriginal(t *testing.T) {
	o := Original{Neto: 82.64, Iva21: 17.36, Total: 100}
	primera := CalcularNota(o, tresPorCien(0, 0), []CantidadAAcreditar{{"a", 1}}, nil)
	if primera.Total != 33.33 {
		t.Fatalf("la primera da %v, quería 33,33", primera.Total)
	}
	o.Acreditado = primera.Total
	segunda := CalcularNota(o, tresPorCien(1, 33.33), []CantidadAAcreditar{{"a", 2}}, nil)
	if segunda.Problema != "" || segunda.Total != 66.67 {
		t.Fatalf("la segunda da %v (%q), quería 66,67", segunda.Total, segunda.Problema)
	}
}

func TestDosParcialesConPercepcionSumanExacto(t *testing.T) {
	percepcion := []Tributo{{Codigo: "02", Descripcion: "Percepción Ingresos Brutos", Base: 82.64, Alicuota: 3, Importe: 2.48}}
	o := Original{Neto: 82.64, Iva21: 17.36, Total: 102.48}
	primera := CalcularNota(o, tresPorCien(0, 0), []CantidadAAcreditar{{"a", 1}}, percepcion)
	o.Acreditado = primera.Total
	o.TributosDevueltos = map[string]Tributo{"02": primera.TributosDados[0]}
	segunda := CalcularNota(o, tresPorCien(1, Redondear(primera.Total-primera.TributosDados[0].Importe)),
		[]CantidadAAcreditar{{"a", 2}}, percepcion)
	if segunda.Problema != "" {
		t.Fatal(segunda.Problema)
	}
	if suma := Redondear(primera.Total + segunda.Total); suma != 102.48 {
		t.Fatalf("las dos suman %v, quería 102,48", suma)
	}
	if p := Redondear(primera.TributosDados[0].Importe + segunda.TributosDados[0].Importe); p != 2.48 {
		t.Fatalf("la percepción devuelta suma %v, quería 2,48", p)
	}
}
