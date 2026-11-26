package ventas

import "testing"

// Un descuento tipeado de $5.000 sobre 3 × $88.700 quedaba en $5.000,01 y la
// venta en $261.099,99 (mes simulado, H425): el reparto redondea cada precio.
// Ahora el renglón se parte (2 + 1) y el centavo lo toma el de a uno.
func TestDescuentoAlCentavo(t *testing.T) {
	v := "v1"
	lineas := []LineaDeVenta{{VariantID: &v, Descripcion: "Deck", Unidad: "unidad", Cantidad: 3, PrecioUnitario: 88700}}
	rebajadas, descuento := AplicarDescuento(lineas, 5000)
	if descuento != 5000 || TotalDeLaVenta(rebajadas) != 261100 {
		t.Fatalf("descuento %v, total %v: %+v", descuento, TotalDeLaVenta(rebajadas), rebajadas)
	}
	if len(rebajadas) != 2 || rebajadas[0].Cantidad+rebajadas[1].Cantidad != 3 {
		t.Fatalf("partida: %+v", rebajadas)
	}

	// Con un renglón de a uno, lo toma ese y no se parte nada.
	w := "v2"
	lineas = append(lineas, LineaDeVenta{VariantID: &w, Descripcion: "Laca", Unidad: "unidad", Cantidad: 1, PrecioUnitario: 12345})
	rebajadas, descuento = AplicarDescuento(lineas, 5000)
	if descuento != 5000 || len(rebajadas) != 2 {
		t.Fatalf("con uno de a uno: %v %+v", descuento, rebajadas)
	}
}

// El descuento por forma de pago no toca un renglón a mano (el flete): se
// reparte solo entre los productos y el corte (mes simulado, H168).
func TestDescuentoSobreLoElegible(t *testing.T) {
	v := "v1"
	lineas := []LineaDeVenta{
		{VariantID: &v, Descripcion: "Placa", Unidad: "placa", Cantidad: 2, PrecioUnitario: 50000},
		{Descripcion: "Flete a domicilio", Unidad: "unidad", Cantidad: 1, PrecioUnitario: 15000},
	}
	rebajadas, descuento := AplicarDescuentoSobre(lineas, 10000, EsElegibleParaLaEscala)
	if descuento != 10000 || rebajadas[1].PrecioUnitario != 15000 || rebajadas[0].PrecioUnitario != 45000 || len(rebajadas) != 2 {
		t.Fatalf("%v %+v", descuento, rebajadas)
	}
}
