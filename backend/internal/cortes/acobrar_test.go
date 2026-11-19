package cortes

import "testing"

// Acomodar a mano no esquiva la media placa (T3, hallazgo 11): dos piezas
// del 26 % juntas son una placa del 52 %, que se vende entera; mandarlas a
// dos placas dejaba dos placas por debajo de la mitad y no se cobraba
// material. Se cobra el plano libre, salvo que el manual gaste más placas.
func TestACobrar(t *testing.T) {
	piezas := []PiezaAcortar{
		{LargoMm: 1300, AnchoMm: 1000, Cantidad: 1},
		{LargoMm: 1300, AnchoMm: 1000, Cantidad: 1},
	}
	sierra := 4.0
	base := DatosDelPlano{Piezas: piezas, PlacaLargo: 2750, PlacaAncho: 1830, AnchoSierra: &sierra}
	libre := CalcularPlano(base)
	if libre.PlacasEnteras != 1 {
		t.Fatalf("el plano libre junta las dos en una placa entera: %+v", libre)
	}
	if c := ACobrar(base); c.Placas != 1 || c.Pasadas != libre.PasadasCobrables || c.Manual {
		t.Fatalf("sin acomodo: %+v", c)
	}

	separadas := base
	separadas.Fijadas = []PiezaFijada{{Indice: 0, Unidad: 1, Placa: 1}, {Indice: 1, Unidad: 1, Placa: 2}}
	manual := CalcularPlano(separadas)
	if manual.PlacasEnteras != 0 || len(manual.Placas) != 2 {
		t.Fatalf("el acomodo a mano deja dos placas por debajo de la mitad: %+v", manual)
	}
	if c := ACobrar(separadas); c.Placas != 1 || c.Pasadas != libre.PasadasCobrables || c.Manual {
		t.Fatalf("acomodo que esquiva la media placa: %+v, se cobra el libre %d/%d", c, libre.PlacasEnteras, libre.PasadasCobrables)
	}

	// Al revés: si el manual gasta más placas que el libre, se cobra el
	// manual (alguien eligió gastar más material).
	chicas := DatosDelPlano{Piezas: []PiezaAcortar{{LargoMm: 1500, AnchoMm: 1000, Cantidad: 1}, {LargoMm: 400, AnchoMm: 300, Cantidad: 1}},
		PlacaLargo: 2750, PlacaAncho: 1830, AnchoSierra: &sierra}
	chicas.Fijadas = []PiezaFijada{{Indice: 0, Unidad: 1, Placa: 1}, {Indice: 1, Unidad: 1, Placa: 2}}
	m, l := CalcularPlano(chicas), CalcularPlano(DatosDelPlano{Piezas: chicas.Piezas, PlacaLargo: 2750, PlacaAncho: 1830, AnchoSierra: &sierra})
	if c := ACobrar(chicas); m.PlacasEnteras > l.PlacasEnteras && (!c.Manual || c.Placas != m.PlacasEnteras || c.Pasadas != m.PasadasCobrables) {
		t.Fatalf("el manual que gasta más: %+v (manual %d, libre %d)", c, m.PlacasEnteras, l.PlacasEnteras)
	}
}
