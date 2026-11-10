package checkout

import (
	"strings"
	"testing"

	"mjbj/internal/pruebas"
)

// Con la tienda apagada el carrito no se llena ni se cobra; un carrito armado
// antes se lee vacío y se puede vaciar.
func TestCarritoConLaTiendaApagada(t *testing.T) {
	e := armar(t)
	c := e.anonimo()
	u := e.srv.URL + "/api/v1/carrito"
	// Uno armado con la tienda encendida.
	if code, b := pedir(t, c, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "cantidad": 2}); code != 200 {
		t.Fatalf("agregar encendida: %d %s", code, b)
	}
	pruebas.TiendaApagada(t, e.pool)

	if code, b := pedir(t, c, "GET", u, nil); code != 200 || strings.Contains(b, "84500") || leer[Carrito](t, b).CantidadItems != 0 {
		t.Errorf("leer apagada: %d %s", code, b)
	}
	cortadas := []struct {
		metodo, ruta string
		cuerpo       any
	}{
		{"POST", "/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "cantidad": 1}},
		{"POST", "/items/varios", map[string]any{"items": []any{map[string]any{"variantId": e.placa, "descripcion": "Fenólico", "cantidad": 1}}}},
		{"POST", "/precios", nil},
		{"POST", "/presupuesto", map[string]any{"nombre": "Juan", "telefono": "2235551234"}},
		{"POST", "/confirmar", e.compra(nil)},
	}
	for _, x := range cortadas {
		if code, b := pedir(t, c, x.metodo, u+x.ruta, x.cuerpo); code != 403 || !strings.Contains(b, "WhatsApp") {
			t.Errorf("%s %s apagada: %d %s", x.metodo, x.ruta, code, b)
		}
	}
	if code, b := pedir(t, c, "DELETE", u, nil); code != 200 {
		t.Errorf("vaciar apagada: %d %s", code, b)
	}
	if n := e.numero(t, `select count(*) from orders`); n != 0 {
		t.Errorf("se creó un pedido con la tienda apagada: %v", n)
	}
}
