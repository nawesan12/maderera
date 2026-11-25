package whatsapp

import (
	"strings"
	"testing"
)

// Dónde hay sale de la lista de sucursales activas: con una tercera, el bot
// la nombra sin tocar código (hallazgo 35).
func TestBotDiceDondeHay(t *testing.T) {
	for _, c := range []struct {
		con   []string
		total int
		dice  string
	}{
		{nil, 2, ""},
		{[]string{"Casa Central", "Aserradero"}, 2, "Hay en las dos sucursales"},
		{[]string{"Casa Central"}, 2, "Hay en Casa Central"},
		{[]string{"Aserradero"}, 2, "Hay en el Aserradero"},
		{[]string{"Casa Central", "Aserradero", "Puerto"}, 3, "Hay en todas las sucursales"},
		{[]string{"Aserradero", "Puerto"}, 3, "Hay en el Aserradero y Puerto"},
		{[]string{"Casa Central", "Aserradero", "Puerto"}, 4, "Hay en Casa Central, el Aserradero y Puerto"},
	} {
		texto := listarProductos([]ProductoBot{{Nombre: "Fenólico", Slug: "fenolico", ConStock: c.con, Sucursales: c.total}}, "https://x", true)
		if c.dice == "" && strings.Contains(texto, "Hay en") || c.dice != "" && !strings.Contains(texto, "\n"+c.dice+"\n") {
			t.Errorf("%v de %d: %q", c.con, c.total, texto)
		}
		if strings.Contains(listarProductos([]ProductoBot{{Nombre: "Fenólico", Slug: "fenolico", ConStock: c.con, Sucursales: c.total}}, "https://x", false), "Hay en") {
			t.Errorf("con el stock oculto dijo dónde hay")
		}
	}
}
