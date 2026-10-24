package plataforma

import (
	"errors"
	"net/http"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

// ValidarContra valida cada pedido contra el contrato OpenAPI de un dominio:
// campos obligatorios, tipos, enums y que no sobren campos
// (`additionalProperties: false`). El código que genera oapi-codegen no lo
// hace: decodifica el JSON y lo que sobra lo ignora en silencio.
//
// Si la ruta no es de este contrato, deja pasar: hay un contrato por dominio
// y los validadores se encadenan.
func ValidarContra(spec *openapi3.T) (func(http.Handler) http.Handler, error) {
	// Sin `servers`: las rutas se buscan solo por camino, venga de donde venga.
	spec.Servers = nil
	router, err := gorillamux.NewRouter(spec)
	if err != nil {
		return nil, err
	}
	opciones := &openapi3filter.Options{
		// La seguridad la resuelve auth.Exigir en cada handler, no el contrato.
		AuthenticationFunc: openapi3filter.NoopAuthenticationFunc,
		MultiError:         true,
	}
	return func(sig http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ruta, params, err := router.FindRoute(r)
			if errors.Is(err, routers.ErrPathNotFound) || errors.Is(err, routers.ErrMethodNotAllowed) {
				sig.ServeHTTP(w, r)
				return
			}
			if err != nil {
				sig.ServeHTTP(w, r)
				return
			}
			entrada := &openapi3filter.RequestValidationInput{Request: r, PathParams: params, Route: ruta, Options: opciones}
			if err := openapi3filter.ValidateRequest(r.Context(), entrada); err != nil {
				EscribirProblema(w, &Problema{
					Titulo:  "El pedido no cumple el contrato",
					Estado:  http.StatusBadRequest,
					Detalle: resumirError(err),
				})
				return
			}
			sig.ServeHTTP(w, r)
		})
	}, nil
}

// resumirError deja solo la primera línea de cada error de kin-openapi: el
// resto es el esquema entero, que no le sirve a nadie en una respuesta.
func resumirError(err error) string {
	var multi openapi3.MultiError
	var partes []string
	if errors.As(err, &multi) {
		for _, e := range multi {
			partes = append(partes, primeraLinea(e.Error()))
		}
	} else {
		partes = append(partes, primeraLinea(err.Error()))
	}
	return strings.Join(partes, "; ")
}

func primeraLinea(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}
