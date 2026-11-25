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

// Un mueble con dos placas: un solo token, cada grupo con su plano y su
// canto, y cada uno pasa a su propia orden de corte.
func TestConsultaConVariasPlacas(t *testing.T) {
	e := armar(t)
	fibro := otraPlaca(t, e)
	u := e.srv.URL + "/api/v1/cortes/consulta"
	delSitio := func(l, a, n, veta, cl, ca int) map[string]any {
		return map[string]any{"largoMm": l, "anchoMm": a, "cantidad": n, "respetaVeta": veta, "cantoLargo": cl, "cantoAncho": ca}
	}
	cuerpo := map[string]any{"sucursal": "casa-central", "grupos": []any{
		map[string]any{"variantId": e.melamina, "cantoDescripcion": "Tapacanto PVC Blanco — 0,45 mm",
			"piezas": []any{delSitio(900, 600, 2, 1, 2, 0)}},
		map[string]any{"variantId": fibro, "piezas": []any{delSitio(880, 580, 1, 0, 0, 0)}},
	}}
	code, b := pedir(t, http.DefaultClient, "POST", u, cuerpo)
	if code != 200 {
		t.Fatalf("guardar: %d %s", code, b)
	}
	var r struct{ Token string }
	_ = json.Unmarshal([]byte(b), &r)

	_, b = pedir(t, http.DefaultClient, "GET", u+"/"+r.Token, nil)
	var c ConsultaDeCorte
	_ = json.Unmarshal([]byte(b), &c)
	if len(c.Grupos) != 2 || c.Material != c.Grupos[0].Material || len(c.Piezas) != 1 || c.Piezas[0].RespetaVeta != 1 {
		t.Fatalf("leer: %s", b)
	}
	g := c.Grupos[1]
	if g.Orden != 1 || !strings.HasPrefix(g.Material, "Fibrofácil") || g.PlacaLargoMm != 2600 || g.CantoDescripcion != nil ||
		len(g.Plano.Placas) != 1 || g.MetrosCanto != 0 || g.CorteID != nil {
		t.Errorf("el fondo: %+v", g)
	}
	if c.Grupos[0].CantoDescripcion == nil || *c.Grupos[0].CantoDescripcion != "Tapacanto PVC Blanco — 0,45 mm" {
		t.Errorf("el canto va con su placa: %+v", c.Grupos[0])
	}

	// El fondo pasa a corte solo, y no se puede pasar dos veces.
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	alta := map[string]any{"contactoNombre": "Por WhatsApp", "materialDescripcion": g.Material, "variantId": fibro,
		"consulta": r.Token, "consultaGrupo": "1", "piezas": []any{pieza(880, 580, 1)}}
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", alta); code != 200 {
		t.Fatalf("pasar el fondo: %d %s", code, b)
	}
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", alta); code != 422 || !strings.Contains(b, "ya se pasó") {
		t.Errorf("el fondo dos veces: %d %s", code, b)
	}
	_, b = pedir(t, http.DefaultClient, "GET", u+"/"+r.Token, nil)
	_ = json.Unmarshal([]byte(b), &c)
	if c.Grupos[1].CorteID == nil || c.Grupos[0].CorteID != nil || c.CorteID != nil {
		t.Errorf("solo el fondo quedó atado: %s", b)
	}
	// La melamina sigue libre.
	alta["consultaGrupo"], alta["variantId"] = "", e.melamina
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", alta); code != 200 {
		t.Errorf("pasar la melamina: %d %s", code, b)
	}
	alta["consultaGrupo"] = "5"
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", alta); code != 422 || !strings.Contains(b, "No encontramos") {
		t.Errorf("grupo que no está: %d %s", code, b)
	}

	// El aviso dice qué placa está mal.
	cuerpo["grupos"] = []any{
		map[string]any{"variantId": e.melamina, "piezas": []any{delSitio(900, 600, 1, 0, 0, 0)}},
		map[string]any{"variantId": fibro, "piezas": []any{delSitio(3000, 600, 1, 0, 0, 0)}},
	}
	if code, b := pedir(t, http.DefaultClient, "POST", u, cuerpo); code != 422 || !strings.Contains(b, "Placa 2") {
		t.Errorf("placa 2 con una pieza que no entra: %d %s", code, b)
	}
	muchos := make([]any, MaximoDeGrupos+1)
	for i := range muchos {
		muchos[i] = map[string]any{"variantId": e.melamina, "piezas": []any{delSitio(900, 600, 1, 0, 0, 0)}}
	}
	cuerpo["grupos"] = muchos
	if code, b := pedir(t, http.DefaultClient, "POST", u, cuerpo); code != 422 || !strings.Contains(b, "demasiadas placas") {
		t.Errorf("demasiadas placas: %d %s", code, b)
	}
}
