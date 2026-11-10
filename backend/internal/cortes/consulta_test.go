package cortes

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"mjbj/internal/pruebas"
)

// El corte que se manda por WhatsApp: se guarda, se lee por el token con el
// mismo plano, y anda con la tienda apagada (es justo su caso).
func TestConsultaDeCorte(t *testing.T) {
	e := armar(t)
	pruebas.TiendaApagada(t, e.pool)
	u := e.srv.URL + "/api/v1/cortes/consulta"
	delSitio := func(l, a, n, cl, ca int) map[string]any {
		return map[string]any{"largoMm": l, "anchoMm": a, "cantidad": n, "respetaVeta": 0, "cantoLargo": cl, "cantoAncho": ca}
	}

	code, b := pedir(t, http.DefaultClient, "POST", u, map[string]any{"variantId": e.melamina, "sucursal": "casa-central",
		"cantoDescripcion": " Blanco ", "piezas": []any{delSitio(900, 600, 3, 2, 1), delSitio(400, 300, 2, 0, 0)}})
	if code != 200 {
		t.Fatalf("guardar: %d %s", code, b)
	}
	var r struct{ Token string }
	_ = json.Unmarshal([]byte(b), &r)
	if len(r.Token) != 16 {
		t.Fatalf("token: %q", r.Token)
	}

	code, b = pedir(t, http.DefaultClient, "GET", u+"/"+r.Token, nil)
	var c ConsultaDeCorte
	_ = json.Unmarshal([]byte(b), &c)
	if code != 200 || c.Material == "" || c.PlacaLargoMm != 2750 || len(c.Piezas) != 2 || c.Sucursal == nil || *c.Sucursal != "casa-central" ||
		c.CantoDescripcion == nil || *c.CantoDescripcion != "Blanco" || len(c.Plano.Placas) != 1 || c.Plano.TotalPiezas != 5 {
		t.Fatalf("leer: %d %s", code, b)
	}
	// 3 piezas × (2 × 0,9 + 1 × 0,6) = 7,2 m de canto.
	if c.MetrosCanto < 7.19 || c.MetrosCanto > 7.21 {
		t.Errorf("metros de canto: %v", c.MetrosCanto)
	}
	if strings.Contains(b, "84500") {
		t.Errorf("la consulta no lleva precios: %s", b)
	}

	// Pasarla a corte desde el panel la deja atada: el enlace ya no ofrece
	// pasarla otra vez, y una segunda alta no le cambia el corte.
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	alta := map[string]any{"contactoNombre": "Por WhatsApp", "materialDescripcion": c.Material, "variantId": e.melamina,
		"consulta": r.Token, "piezas": []any{pieza(900, 600, 3, "cantoLargo", 2, "cantoAncho", 1)}}
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", alta); code != 200 {
		t.Fatalf("pasar a corte: %d %s", code, b)
	}
	pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", alta)
	_, b = pedir(t, http.DefaultClient, "GET", u+"/"+r.Token, nil)
	_ = json.Unmarshal([]byte(b), &c)
	var primero string
	_ = e.pool.QueryRow(context.Background(), `select id::text from cutting_orders where numero = 'CRT-1'`).Scan(&primero)
	if c.CorteID == nil || *c.CorteID != primero {
		t.Errorf("atada al corte: %v, quería %s", c.CorteID, primero)
	}

	if code, _ := pedir(t, http.DefaultClient, "GET", u+"/noexiste12345678", nil); code != 404 {
		t.Errorf("token falso: %d", code)
	}
	if code, b := pedir(t, http.DefaultClient, "POST", u, map[string]any{"variantId": e.melamina, "sucursal": "la-luna",
		"piezas": []any{delSitio(900, 600, 1, 0, 0)}}); code != 422 || !strings.Contains(b, "sucursal") {
		t.Errorf("sucursal inexistente: %d %s", code, b)
	}
	if code, b := pedir(t, http.DefaultClient, "POST", u, map[string]any{"variantId": e.melamina,
		"piezas": []any{delSitio(3000, 600, 1, 0, 0)}}); code != 422 || !strings.Contains(b, "no entra") {
		t.Errorf("no entra: %d %s", code, b)
	}
}
