package pdf

import "testing"

// «Lista Lista profesional» (mes simulado, M2S3-093) y la lata de 4 litros
// que el presupuesto vendía como «2 l» (M2S3-074).
func TestTituloYUnidadDelMes(t *testing.T) {
	if got := TituloDeLista("Lista profesional"); got != "Lista profesional" {
		t.Errorf("título: %q", got)
	}
	if got := TituloDeLista("Gremio"); got != "Lista Gremio" {
		t.Errorf("título: %q", got)
	}
	if got := Unidad(UnidadDeVenta("litro", "Laca Poliuretánica - 4 litros")); got != "u." {
		t.Errorf("unidad de la lata: %q", got)
	}
}
