package whatsapp

import (
	"strings"
	"testing"
)

// «Tienen corredera telescópica de 50?» con la de 50 cm en cero en las dos
// sucursales contestaba «Hay en Casa Central» con el stock de la de 45: el
// número sin unidad se buscaba solo en mm (mes 23, admin-atencion-Natención-1).
func TestBotStockDeLaMedidaEnCentimetros(t *testing.T) {
	d := datosDePrueba
	d.StockVisible = true
	d.Productos = []ProductoBot{{Nombre: "Corredera Telescópica", Slug: "corredera", Medidas: []string{"45cm", "50cm"},
		ConStock: []string{"Casa Central"}, Sucursales: 2,
		StockPorMedida: map[string][]string{"45cm": {"Casa Central"}}}}
	r := Responder("Tienen corredera telescópica de 50?", EstadoBot{}, d, true)
	if strings.Contains(r.Texto, "Hay en") || !strings.Contains(r.Texto, "Sin stock ahora") || strings.Contains(r.Texto, "45cm") {
		t.Errorf("corredera de 50: %q", r.Texto)
	}
	r = Responder("Tienen corredera telescópica de 45?", EstadoBot{}, d, true)
	if !strings.Contains(r.Texto, "Hay en Casa Central") {
		t.Errorf("corredera de 45: %q", r.Texto)
	}
}
