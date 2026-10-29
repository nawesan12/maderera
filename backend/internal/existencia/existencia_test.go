package existencia

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"mjbj/internal/api/existenciaapi"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
)

func TestExiste(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	silencio := slog.New(slog.NewTextHandler(io.Discard, nil))
	m := http.NewServeMux()
	existenciaapi.HandlerWithOptions(
		existenciaapi.NewStrictHandlerWithOptions(NuevaAPI(pool, plataforma.ConfigInterna{Secreto: "s3creto"}),
			[]existenciaapi.StrictMiddlewareFunc{plataforma.ConPedido[existenciaapi.StrictHandlerFunc]},
			existenciaapi.StrictHTTPServerOptions{RequestErrorHandlerFunc: plataforma.ErrorDePedido, ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(silencio)}),
		existenciaapi.StdHTTPServerOptions{BaseRouter: m},
	)
	spec, _ := existenciaapi.GetSwagger()
	srv := httptest.NewServer(pruebas.ConContrato(t, spec, m))
	defer srv.Close()
	var id string
	_ = pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre) values ('PED-0007', 'Juan') returning id`).Scan(&id)

	pedir := func(q string, secreto bool) (int, string) {
		req, _ := http.NewRequest("GET", srv.URL+"/api/v1/interno/existe?"+q, nil)
		if secreto {
			req.Header.Set("Authorization", "Bearer s3creto")
		}
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		b, _ := io.ReadAll(r.Body)
		return r.StatusCode, string(b)
	}
	if c, _ := pedir("que=pedido-por-numero&clave=PED-0007", false); c != 403 {
		t.Errorf("sin el secreto: %d", c)
	}
	for q, quiere := range map[string]string{
		"que=pedido-por-numero&clave=PED-0007": `{"existe":true}`,
		"que=pedido-por-numero&clave=PED-0008": `{"existe":false}`,
		"que=pedido&clave=" + id:               `{"existe":true}`,
		"que=pedido&clave=PED-0007":            `{"existe":false}`,
		"que=cliente&clave=" + id:              `{"existe":false}`,
	} {
		if c, b := pedir(q, true); c != 200 || b != quiere+"\n" {
			t.Errorf("%s: %d %s", q, c, b)
		}
	}
}
