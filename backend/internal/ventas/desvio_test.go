package ventas

import "testing"

func f(n float64) *float64 { return &n }

// La regla del 5 % (T3, hallazgo 10 y crítica del operario): se mide sobre el
// total de lista, un renglón por encima no compensa, y el «redondeame» sobre
// el total cuenta.
func TestDesvioDeLaVenta(t *testing.T) {
	placa := LineaDeVenta{VariantID: f2s("v1"), Cantidad: 2, PrecioUnitario: 45000, PrecioLista: f(45000.5)}
	tornillo := LineaDeVenta{VariantID: f2s("v2"), Cantidad: 100, PrecioUnitario: 160, PrecioLista: f(150)}
	flete := LineaDeVenta{Cantidad: 1, PrecioUnitario: 12000}

	d := DesvioDeLaVenta([]LineaDeVenta{placa, tornillo, flete}, 0, 0)
	// 2 × 0,50 bajo la lista; el tornillo por encima no compensa.
	if d.BajoLista != 1 || d.Total != 1 || d.Base != 90001+15000+12000 {
		t.Fatalf("renglones: %+v", d)
	}
	// El cliente pide «redondeame a 115.000»: 2001 de descuento a mano.
	d = DesvioDeLaVenta([]LineaDeVenta{placa, tornillo, flete}, 2001, 0)
	if d.Total != 2002 || !d.DentroDeLoLibre(5) {
		t.Fatalf("redondeo dentro del 5 %%: %+v", d)
	}
	// El 5 % de 117.001 son 5850,05: un peso más ya pide PIN.
	if d := DesvioDeLaVenta([]LineaDeVenta{placa, tornillo, flete}, 5849.05, 0); !d.DentroDeLoLibre(5) || d.Total != 5850.05 {
		t.Fatalf("en el borde: %+v", d)
	}
	if d := DesvioDeLaVenta([]LineaDeVenta{placa, tornillo, flete}, 5850.05, 0); d.DentroDeLoLibre(5) {
		t.Fatalf("pasado el borde: %+v", d)
	}
	// Con 0 % todo pide PIN; sin nada dejado de cobrar, nunca.
	if DesvioDeLaVenta([]LineaDeVenta{placa}, 0, 0).DentroDeLoLibre(0) {
		t.Fatal("con 0 % el peso de diferencia pide PIN")
	}
	if !DesvioDeLaVenta([]LineaDeVenta{tornillo, flete}, 0, 0).DentroDeLoLibre(0) {
		t.Fatal("sin nada dejado de cobrar no pide nada")
	}
	// Lo que falta del corte suma a lo dejado y a la base.
	if d := DesvioDeLaVenta([]LineaDeVenta{flete}, 0, 45000.5); d.Corte != 45000.5 || d.Base != 57000.5 || d.DentroDeLoLibre(10) {
		t.Fatalf("corte: %+v", d)
	}
}

func f2s(s string) *string { return &s }
