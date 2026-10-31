package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// configCorreo es lo que necesita el worker para hablar con el servidor de
// correo (Stalwart, servicio `correo`) por su API de administración. Sin
// CORREO_ADMIN_CLAVE el correo propio no está en uso y la tarea no se suma.
type configCorreo struct {
	AdminClave   string `env:"CORREO_ADMIN_CLAVE"`
	Dominio      string `env:"CORREO_DOMINIO"`
	DominioSitio string `env:"DOMINIO"`
	URL          string `env:"CORREO_ADMIN_URL" envDefault:"http://correo:8080"`
}

func (c configCorreo) admin() string {
	d := strings.TrimSpace(c.Dominio)
	if d == "" {
		d = strings.TrimSpace(c.DominioSitio)
	}
	return "admin@" + d
}

// recargarCertificadoDelCorreo le pide a Stalwart que vuelva a leer el
// certificado de mail.<dominio>. Lo saca y lo renueva Caddy, y Stalwart lee
// los archivos solo al cargarlos: sin esto, a los 90 días el correo seguiría
// con el vencido. Es la acción ReloadTlsCertificates de su API (JMAP), la
// misma que `scripts/correo.sh recargar-certificado`.
func recargarCertificadoDelCorreo(ctx context.Context, c configCorreo, cliente *http.Client) error {
	cuerpo, _ := json.Marshal(map[string]any{
		"using": []string{"urn:ietf:params:jmap:core", "urn:stalwart:jmap"},
		"methodCalls": []any{[]any{"x:Action/set",
			map[string]any{"create": map[string]any{"a": map[string]any{"@type": "ReloadTlsCertificates"}}}, "0"}},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.URL, "/")+"/jmap", bytes.NewReader(cuerpo))
	if err != nil {
		return err
	}
	req.SetBasicAuth(c.admin(), c.AdminClave)
	req.Header.Set("Content-Type", "application/json")
	resp, err := cliente.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("el servidor de correo respondió %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	// JMAP responde 200 aunque la acción falle: el error viene adentro.
	var r struct {
		MethodResponses [][]json.RawMessage `json:"methodResponses"`
	}
	if err := json.Unmarshal(b, &r); err != nil || len(r.MethodResponses) == 0 || len(r.MethodResponses[0]) < 2 {
		return fmt.Errorf("respuesta inesperada del servidor de correo: %s", strings.TrimSpace(string(b)))
	}
	var resultado struct {
		Created    map[string]any `json:"created"`
		NotCreated map[string]any `json:"notCreated"`
	}
	_ = json.Unmarshal(r.MethodResponses[0][1], &resultado)
	if len(resultado.Created) == 0 {
		return fmt.Errorf("el servidor de correo no recargó el certificado: %s", strings.TrimSpace(string(r.MethodResponses[0][1])))
	}
	return nil
}
