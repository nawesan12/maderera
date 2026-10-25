package pruebas

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

// ConContrato envuelve un handler y hace fallar el test si una respuesta no
// cumple el contrato OpenAPI (campos que faltan, tipos, enums). Los handlers
// escriben las estructuras del servicio tal cual; esto es lo que asegura que
// tengan la forma que promete el contrato y que usa Next.
func ConContrato(t testing.TB, spec *openapi3.T, h http.Handler) http.Handler {
	t.Helper()
	spec.Servers = nil
	router, err := gorillamux.NewRouter(spec)
	if err != nil {
		t.Fatal(err)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ruta, params, err := router.FindRoute(r)
		if err != nil {
			h.ServeHTTP(w, r)
			return
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		entrada := &openapi3filter.RequestValidationInput{
			Request: r, PathParams: params, Route: ruta,
			Options: &openapi3filter.Options{AuthenticationFunc: openapi3filter.NoopAuthenticationFunc, ExcludeRequestBody: true},
		}
		if err := openapi3filter.ValidateResponse(context.Background(), &openapi3filter.ResponseValidationInput{
			RequestValidationInput: entrada, Status: rec.Code, Header: rec.Header(),
			Body: io.NopCloser(bytes.NewReader(rec.Body.Bytes())),
		}); err != nil {
			t.Errorf("%s %s → %d no cumple el contrato: %v", r.Method, r.URL.Path, rec.Code, err)
		}
		for k, v := range rec.Header() {
			w.Header()[k] = v
		}
		w.WriteHeader(rec.Code)
		_, _ = w.Write(rec.Body.Bytes())
	})
}
