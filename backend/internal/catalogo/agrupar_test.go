package catalogo

import (
	"strings"
	"testing"
)

// H213 (mes simulado): con la tienda apagada, «Sugeridos» ponía lo destacado
// primero y cada rubro salía dos veces (Decks, Pisos flotantes, Tirantería).
func TestTiendaApagadaAgrupaPorRubro(t *testing.T) {
	r := func(s string) *string { return &s }
	ps := []ProductoListado{
		{Name: "Deck Lapacho", CategorySlug: "exterior", Subcategory: r("Decks")},
		{Name: "Tirante 2x4", CategorySlug: "maderas", Subcategory: r("Tirantería"), Featured: true},
		{Name: "Deck Pino", CategorySlug: "exterior", Subcategory: r("Decks"), Featured: true},
		{Name: "Piso Roble", CategorySlug: "exterior", Subcategory: r("Pisos flotantes"), Featured: true},
		{Name: "Tirante 3x3", CategorySlug: "maderas", Subcategory: r("Tirantería")},
	}
	ordenar(ps, Filtros{Orden: "relevancia", sinPrecios: true, sinStock: true})
	var nombres []string
	for _, p := range ps {
		nombres = append(nombres, p.Name)
	}
	quiero := "Deck Pino, Deck Lapacho, Piso Roble, Tirante 2x4, Tirante 3x3"
	if got := strings.Join(nombres, ", "); got != quiero {
		t.Errorf("orden: %s\nquiero: %s", got, quiero)
	}
}
