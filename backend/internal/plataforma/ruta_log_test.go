package plataforma

import "testing"

// Los tokens que valen como llave no quedan en el registro (comité del
// 25/11): el del enlace de firma de un remito y el de la consulta de corte.
func TestRutaParaElLog(t *testing.T) {
	for ruta, quiero := range map[string]string{
		"/api/v1/firmar/abc123":            "/api/v1/firmar/oculto",
		"/api/v1/firmar":                   "/api/v1/firmar",
		"/api/v1/firmar/":                  "/api/v1/firmar/",
		"/api/v1/cortes/consulta/xyz":      "/api/v1/cortes/consulta/oculto",
		"/api/v1/admin/pedidos/1/remitos":  "/api/v1/admin/pedidos/1/remitos",
		"/api/v1/catalogo/productos/firma": "/api/v1/catalogo/productos/firma",
	} {
		if got := RutaParaElLog(ruta); got != quiero {
			t.Errorf("%s: %s, quería %s", ruta, got, quiero)
		}
	}
}
