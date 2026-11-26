package cortes

import "testing"

// Las placas que no pasan la mitad se cuentan aparte: el mostrador dice
// «Material sin cargo» al armar el corte (mes simulado, H019 y H174).
func TestCobroCuentaLasParciales(t *testing.T) {
	sierra := 4.0
	chico := ACobrar(DatosDelPlano{PlacaLargo: 2440, PlacaAncho: 1220, AnchoSierra: &sierra,
		Piezas: []PiezaAcortar{{LargoMm: 600, AnchoMm: 300, Cantidad: 3}}})
	if chico.Placas != 0 || chico.Parciales != 1 {
		t.Errorf("corte chico: %+v", chico)
	}
	grande := ACobrar(DatosDelPlano{PlacaLargo: 2440, PlacaAncho: 1220, AnchoSierra: &sierra,
		Piezas: []PiezaAcortar{{LargoMm: 1100, AnchoMm: 800, Cantidad: 2}}})
	if grande.Placas != 1 || grande.Parciales != 0 {
		t.Errorf("corte grande: %+v", grande)
	}
}
