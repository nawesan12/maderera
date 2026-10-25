package main

import (
	"context"
	"net/http"

	"github.com/getkin/kin-openapi/openapi3"

	"mjbj/internal/api/catalogoapi"
	"mjbj/internal/api/contenidoapi"
	"mjbj/internal/api/productosapi"
	"mjbj/internal/api/sesionapi"
	"mjbj/internal/auth"
	"mjbj/internal/catalogo"
	"mjbj/internal/contenido"
	"mjbj/internal/email"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
	"mjbj/internal/productos"
	"mjbj/internal/sqlc"
	"mjbj/internal/subidas"
	"mjbj/internal/vivo"
)

type configAPI struct {
	Escuchar string `env:"API_ESCUCHAR" envDefault:":8080"`
	Base     plataforma.ConfigBase
	Auth     auth.Config
	Subidas  subidas.Config
	Google   contenido.ConfigGoogle
	Contacto contenido.ConfigContacto
	Email    email.Config
	Interna  plataforma.ConfigInterna
}

func correrAPI() error {
	log := plataforma.Registro("api")
	cfg, err := plataforma.Cargar[configAPI]()
	if err != nil {
		return err
	}
	ctx, parar := context.WithCancel(context.Background())
	defer parar()
	pool, err := cfg.Base.Pool(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()

	q := sqlc.New(pool)
	sesiones := auth.Nuevo(cfg.Auth, pool)
	lim := limites.Nuevo(q, log)

	m := http.NewServeMux()
	m.HandleFunc("GET /salud", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusServiceUnavailable, "sin base"))
			return
		}
		_, _ = w.Write([]byte("ok"))
	})

	// El tiempo real: una conexión LISTEN por proceso, repartida por SSE.
	urlBase, err := cfg.Base.URLConexion()
	if err != nil {
		return err
	}
	central := vivo.Nueva(urlBase, log)
	go central.Correr(ctx)
	m.Handle("GET /api/v1/vivo", central)
	m.Handle("GET /api/vivo", central) // la dirección que usan hoy las pantallas

	// Lo que no es de ningún dominio: 404, en el mismo formato que el resto.
	m.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusNotFound, "Esa ruta no existe."))
	})

	// Cada dominio registra sus rutas en el mismo mux. Todos con las mismas
	// piezas: el pedido en el contexto y los errores como problem+json.
	sesionapi.HandlerWithOptions(
		sesionapi.NewStrictHandlerWithOptions(auth.NuevaAPI(sesiones, lim),
			[]sesionapi.StrictMiddlewareFunc{plataforma.ConPedido[sesionapi.StrictHandlerFunc]},
			sesionapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		sesionapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	catalogoapi.HandlerWithOptions(
		catalogoapi.NewStrictHandlerWithOptions(catalogo.NuevaAPI(catalogo.Nuevo(pool), lim, cfg.Interna),
			[]catalogoapi.StrictMiddlewareFunc{plataforma.ConPedido[catalogoapi.StrictHandlerFunc]},
			catalogoapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		catalogoapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	contenidoapi.HandlerWithOptions(
		contenidoapi.NewStrictHandlerWithOptions(contenido.NuevaAPI(contenido.Nuevo(pool, subidas.Nuevo(cfg.Subidas), log), cfg.Google, cfg.Contacto, email.Elegir(cfg.Email, log), lim),
			[]contenidoapi.StrictMiddlewareFunc{plataforma.ConPedido[contenidoapi.StrictHandlerFunc]},
			contenidoapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		contenidoapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	productosapi.HandlerWithOptions(
		productosapi.NewStrictHandlerWithOptions(productos.NuevaAPI(productos.Nuevo(pool, subidas.Nuevo(cfg.Subidas), log)),
			[]productosapi.StrictMiddlewareFunc{plataforma.ConPedido[productosapi.StrictHandlerFunc]},
			productosapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		productosapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// Cada pedido se valida contra el contrato de su dominio antes de llegar
	// al handler.
	var h http.Handler = m
	for _, spec := range []func() (*openapi3.T, error){sesionapi.GetSwagger, catalogoapi.GetSwagger, contenidoapi.GetSwagger, productosapi.GetSwagger} {
		s, err := spec()
		if err != nil {
			return err
		}
		validar, err := plataforma.ValidarContra(s)
		if err != nil {
			return err
		}
		h = validar(h)
	}

	// La sesión se lee en todos los pedidos de la API; /salud no la necesita
	// pero tampoco molesta (sin cookie no toca la base).
	return plataforma.Servir(cfg.Escuchar, plataforma.Cadena(sesiones.Middleware(h), log), log)
}
