package plataforma

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
)

// Lo común a los servidores generados por oapi-codegen (internal/api/*):
// cada dominio tiene su paquete con sus tipos, pero todos se arman igual.

type claveEscritor struct{}
type clavePedido struct{}

// HandlerEstricto es la forma de StrictHandlerFunc de oapi-codegen. Cada
// paquete generado tiene su propio tipo con nombre y esta forma, por eso
// ConPedido es genérico: `plataforma.ConPedido[catalogoapi.StrictHandlerFunc]`.
type HandlerEstricto interface {
	~func(ctx context.Context, w http.ResponseWriter, r *http.Request, req any) (any, error)
}

// ConPedido es un middleware estricto que deja el ResponseWriter y el pedido
// en el contexto: los handlers estrictos solo reciben el contexto, y entrar
// o salir tienen que escribir cookies, y casi todos necesitan la IP.
func ConPedido[F HandlerEstricto](f F, _ string) F {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, req any) (any, error) {
		ctx = context.WithValue(ctx, claveEscritor{}, w)
		ctx = context.WithValue(ctx, clavePedido{}, r)
		return f(ctx, w, r, req)
	}
}

// EscritorDe es el ResponseWriter del pedido (ver ConPedido).
func EscritorDe(ctx context.Context) http.ResponseWriter {
	w, _ := ctx.Value(claveEscritor{}).(http.ResponseWriter)
	return w
}

// PedidoDe es el *http.Request (ver ConPedido).
func PedidoDe(ctx context.Context) *http.Request {
	r, _ := ctx.Value(clavePedido{}).(*http.Request)
	return r
}

// ErrorDePedido es lo que se contesta cuando el cuerpo o los parámetros no
// tienen la forma del contrato.
func ErrorDePedido(w http.ResponseWriter, _ *http.Request, err error) {
	EscribirProblema(w, NuevoProblema(http.StatusBadRequest, "El pedido no tiene la forma esperada."))
}

// ErrorDeRespuesta escribe lo que devolvió un handler: un *Problema tal cual
// (es un error esperado: datos inválidos, sin permiso), cualquier otra cosa
// como 500 y al registro.
func ErrorDeRespuesta(log *slog.Logger) func(http.ResponseWriter, *http.Request, error) {
	return func(w http.ResponseWriter, r *http.Request, err error) {
		var p *Problema
		if errors.As(err, &p) {
			EscribirProblema(w, p)
			return
		}
		if errors.Is(err, context.Canceled) {
			return
		}
		log.Error("error en la API", "id", IDDelPedido(r.Context()), "ruta", r.URL.Path, "error", err)
		EscribirProblema(w, NuevoProblema(http.StatusInternalServerError, "Algo falló de nuestro lado. Probá de nuevo en un momento."))
	}
}
