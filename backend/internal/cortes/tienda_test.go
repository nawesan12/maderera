package cortes

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"mjbj/internal/pruebas"
)

// Con la tienda apagada el armador sigue ofreciendo las placas y dibujando el
// plano, pero sin precios, y no cotiza para el carrito.
func TestArmadorConLaTiendaApagada(t *testing.T) {
	e := armar(t)
	pruebas.TiendaApagada(t, e.pool)
	u := e.srv.URL + "/api/v1/cortes/"

	for _, ruta := range []string{"placas?publico=true", "placas"} {
		_, b := pedir(t, http.DefaultClient, "GET", u+ruta, nil)
		var placas []PlacaCortable
		_ = json.Unmarshal([]byte(b), &placas)
		if len(placas) != 1 || placas[0].Precio != 0 || placas[0].PrecioPorPasada != 0 || placas[0].PrecioPorMetroCanto != 0 {
			t.Errorf("%s: %s", ruta, b)
		}
	}
	_, b := pedir(t, http.DefaultClient, "GET", u+"placas?lista="+e.mayorista, nil, "Authorization", "Bearer "+secretoInterno)
	if strings.Contains(b, "76050") || strings.Contains(b, "996") {
		t.Errorf("la lista del mayorista: %s", b)
	}
	code, b := pedir(t, http.DefaultClient, "POST", u+"plano", map[string]any{
		"piezas": []any{map[string]any{"largoMm": 900, "anchoMm": 600, "cantidad": 3, "respetaVeta": 0}}, "placaLargo": 2750, "placaAncho": 915,
	})
	if code != 200 || !strings.Contains(b, `"plano"`) {
		t.Errorf("el plano: %d %s", code, b)
	}
	code, b = pedir(t, http.DefaultClient, "POST", u+"cotizar", map[string]any{"variantId": e.melamina,
		"piezas": []any{map[string]any{"largoMm": 900, "anchoMm": 600, "cantidad": 1, "respetaVeta": 0, "cantoLargo": 0, "cantoAncho": 0}}})
	if code != 403 {
		t.Errorf("cotizar: %d %s", code, b)
	}
}
