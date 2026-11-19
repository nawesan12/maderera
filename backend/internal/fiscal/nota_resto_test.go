package fiscal

import "testing"

// La segunda nota de crédito de un renglón lleva el neto que le queda, no
// el desagregado otra vez (decisión 6 del contador, comité final): 3 placas
// por $100 al 21 % son $82,64 de neto; la primera nota por una lleva 27,55
// y la segunda, por las dos que quedan ($66,67), desagregada daba 55,10 y
// las dos notas sumaban 82,65. Ahora lleva 55,09 y el IVA, el resto.
func TestLaNotaQueCierraLlevaElNetoQueQueda(t *testing.T) {
	item := ItemOriginal{ID: "a", Descripcion: "Placa", Unidad: "placa", Cantidad: 3, Subtotal: 100, AlicuotaIva: 21, Neto: 82.64}
	primera, err := LineasDeLaNota([]ItemOriginal{item}, []CantidadAAcreditar{{ItemID: "a", Cantidad: 1}})
	if err != nil || len(primera) != 1 || primera[0].Neto != nil {
		t.Fatalf("la primera no cierra el renglón: %+v %v", primera, err)
	}
	t1 := CalcularTotales(entradasDe(primera))
	if t1.Neto != 27.55 || t1.Iva != 5.78 {
		t.Fatalf("primera: %+v", t1)
	}
	item.Acreditado, item.AcreditadoImporte, item.AcreditadoNeto = 1, t1.Total, t1.Neto
	segunda, err := LineasDeLaNota([]ItemOriginal{item}, []CantidadAAcreditar{{ItemID: "a", Cantidad: 2}})
	if err != nil || len(segunda) != 1 || segunda[0].Neto == nil || *segunda[0].Neto != 55.09 {
		t.Fatalf("la segunda: %+v %v", segunda, err)
	}
	t2 := CalcularTotales(entradasDe(segunda))
	if t2.Neto != 55.09 || t2.Iva != 11.58 || t2.Total != 66.67 {
		t.Fatalf("segunda: %+v", t2)
	}
	if n, i := Redondear(t1.Neto+t2.Neto), Redondear(t1.Iva+t2.Iva); n != 82.64 || i != 17.36 {
		t.Errorf("las dos notas: neto %v, IVA %v; el original 82,64 y 17,36", n, i)
	}
	// Un neto que no es un redondeo (otro importe) no se toma.
	raro := 10.0
	if t3 := CalcularTotales([]LineaEntrada{{Cantidad: 1, PrecioFinalUnitario: 121, Neto: &raro}}); t3.Neto != 100 {
		t.Errorf("un neto que no es un redondeo: %+v", t3)
	}
}

func entradasDe(lineas []LineaDeNota) []LineaEntrada {
	out := make([]LineaEntrada, len(lineas))
	for i, l := range lineas {
		alic := l.Alicuota
		out[i] = LineaEntrada{Cantidad: l.Cantidad, PrecioFinalUnitario: l.PrecioFinalUnitario, Alicuota: &alic, Neto: l.Neto}
	}
	return out
}
