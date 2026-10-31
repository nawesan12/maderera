package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecargarCertificadoDelCorreo(t *testing.T) {
	var usuario, clave, metodo string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		usuario, clave, _ = r.BasicAuth()
		b, _ := io.ReadAll(r.Body)
		var pedido struct {
			MethodCalls [][]json.RawMessage `json:"methodCalls"`
		}
		_ = json.Unmarshal(b, &pedido)
		_ = json.Unmarshal(pedido.MethodCalls[0][0], &metodo)
		if !strings.Contains(string(b), `"@type":"ReloadTlsCertificates"`) {
			w.Write([]byte(`{"methodResponses":[["x:Action/set",{"notCreated":{"a":{"type":"invalidProperties"}}},"0"]]}`))
			return
		}
		w.Write([]byte(`{"methodResponses":[["x:Action/set",{"accountId":"b","created":{"a":{"id":"x"}}},"0"]]}`))
	}))
	defer srv.Close()
	c := configCorreo{AdminClave: "secreta", DominioSitio: "mjbj.com.ar", URL: srv.URL}
	if err := recargarCertificadoDelCorreo(context.Background(), c, srv.Client()); err != nil {
		t.Fatal(err)
	}
	if usuario != "admin@mjbj.com.ar" || clave != "secreta" || metodo != "x:Action/set" {
		t.Errorf("pedido: %q %q %q", usuario, clave, metodo)
	}
	// CORREO_DOMINIO manda sobre DOMINIO.
	if (configCorreo{Dominio: "mjbj.ar", DominioSitio: "mjbj.com.ar"}).admin() != "admin@mjbj.ar" {
		t.Error("admin con CORREO_DOMINIO")
	}

	// Una acción rechazada viene con 200: tiene que dar error igual.
	rechaza := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"methodResponses":[["x:Action/set",{"notCreated":{"a":{"type":"forbidden"}}},"0"]]}`))
	}))
	defer rechaza.Close()
	c.URL = rechaza.URL
	if err := recargarCertificadoDelCorreo(context.Background(), c, rechaza.Client()); err == nil {
		t.Error("una acción rechazada no dio error")
	}
}
