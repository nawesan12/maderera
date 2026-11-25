package catalogo

import "testing"

// Comité del 25/11: un filtro de stock que no es una sucursal activa se tomaba
// como su slug y el catálogo quedaba vacío. Ahora vale «en-stock».
func TestFiltroDeStockDesconocido(t *testing.T) {
	sucursales := []sucursalActiva{{"casa-central", "Casa Central"}, {"aserradero", "Aserradero"}}
	casos := map[string]string{
		"": "", "todos": "todos", "en-stock": "en-stock",
		"casa-central": "casa-central", "aserradero": "aserradero",
		"sucursal-cerrada": "en-stock", "<script>": "en-stock", "Casa-Central": "en-stock",
	}
	for pedido, quiero := range casos {
		if got := filtroDeStock(pedido, sucursales); got != quiero {
			t.Errorf("%q: %q, quería %q", pedido, got, quiero)
		}
	}
	if got := filtroDeStock("casa-central", nil); got != "en-stock" {
		t.Errorf("sin sucursales: %q", got)
	}
}
