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
//
// Un candado que no se consiguió a tiempo no es un error del programa: es
// otra operación en curso sobre lo mismo (ver ocupado.go). Una consulta que
// pasó su tope tampoco, pero no es un choque y se dice distinto. Sale como 503, que la cola del mostrador ya reintenta
// sola, con un mensaje que dice qué pasó, y al registro como aviso.
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
		if Ocupado(err) {
			log.Warn("operación ocupada", "id", IDDelPedido(r.Context()), "ruta", r.URL.Path, "error", err)
			EscribirProblema(w, NuevoProblema(http.StatusServiceUnavailable,
				"Hay otra operación en curso sobre lo mismo. Probá de nuevo en unos segundos."))
			return
		}
		// Una consulta que pasó su tope no chocó con nadie: decir «otra
		// operación en curso» invitaba a reintentar lo mismo sin fin (el
		// padrón de ARBA, comité final A5). Sigue siendo 503 —la cola del
		// mostrador la reintenta sola—, pero dice lo que pasó.
		if sentenciaLarga(err) {
			log.Warn("consulta cortada por su tope", "id", IDDelPedido(r.Context()), "ruta", r.URL.Path, "error", err)
			EscribirProblema(w, NuevoProblema(http.StatusServiceUnavailable,
				"La operación tardó demasiado y se cortó. Probá de nuevo en un rato."))
			return
		}
		log.Error("error en la API", "id", IDDelPedido(r.Context()), "ruta", r.URL.Path, "error", err)
		EscribirProblema(w, NuevoProblema(http.StatusInternalServerError, "Algo falló de nuestro lado. Probá de nuevo en un momento."))
	}
}
