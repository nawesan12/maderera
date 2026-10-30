package main

import (
	"context"
	"mjbj/internal/api/cajaapi"
	"mjbj/internal/api/entregasapi"
	"mjbj/internal/api/migracionapi"
	"mjbj/internal/api/mostradorapi"
	"mjbj/internal/api/reportesapi"
	"mjbj/internal/api/ventasapi"
	"mjbj/internal/caja"
	"mjbj/internal/entregas"
	"mjbj/internal/migracion"
	"mjbj/internal/mostrador"
	"mjbj/internal/pedidos"
	"mjbj/internal/reportes"
	"net/http"

	"github.com/getkin/kin-openapi/openapi3"

	"mjbj/internal/api/bitacoraapi"
	"mjbj/internal/api/buscadorapi"
	"mjbj/internal/api/campanasapi"
	"mjbj/internal/api/catalogoapi"
	"mjbj/internal/api/comprasapi"
	"mjbj/internal/api/contenidoapi"
	"mjbj/internal/api/cortesapi"
	"mjbj/internal/api/cuentasapi"
	"mjbj/internal/api/documentosapi"
	"mjbj/internal/api/existenciaapi"
	"mjbj/internal/api/facturacionapi"
	"mjbj/internal/api/portalapi"
	"mjbj/internal/api/preciosapi"
	"mjbj/internal/api/productosapi"
	"mjbj/internal/api/profesionalesapi"
	"mjbj/internal/api/sesionapi"
	"mjbj/internal/api/stockapi"
	"mjbj/internal/api/whatsappapi"
	"mjbj/internal/auth"
	"mjbj/internal/avisos"
	"mjbj/internal/bitacora"
	"mjbj/internal/buscador"
	"mjbj/internal/campanas"
	"mjbj/internal/catalogo"
	"mjbj/internal/clientes"
	"mjbj/internal/cobros"
	"mjbj/internal/compras"
	"mjbj/internal/contenido"
	"mjbj/internal/cortes"
	"mjbj/internal/cuentas"
	"mjbj/internal/diagnostico"
	"mjbj/internal/documentos"
	"mjbj/internal/email"
	"mjbj/internal/existencia"
	"mjbj/internal/facturacion"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
	"mjbj/internal/portal"
	"mjbj/internal/precios"
	"mjbj/internal/productos"
	"mjbj/internal/profesionales"
	"mjbj/internal/push"
	"mjbj/internal/sqlc"
	"mjbj/internal/stock"
	"mjbj/internal/subidas"
	"mjbj/internal/vivo"
	"mjbj/internal/whatsapp"
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
	WhatsApp whatsapp.Config
	Push     push.Config
	Campanas campanas.Config
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
	// Los errores de hidratación que reporta el navegador (la dirección de
	// siempre; Caddy la manda acá).
	m.Handle("POST /api/diagnostico", diagnostico.Handler(lim, log))
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

	preciosapi.HandlerWithOptions(
		preciosapi.NewStrictHandlerWithOptions(precios.NuevaAPI(precios.Nuevo(pool, log), precios.LeerPlanilla),
			[]preciosapi.StrictMiddlewareFunc{plataforma.ConPedido[preciosapi.StrictHandlerFunc]},
			preciosapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		preciosapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	stockapi.HandlerWithOptions(
		stockapi.NewStrictHandlerWithOptions(stock.NuevaAPI(stock.Nuevo(pool, log)),
			[]stockapi.StrictMiddlewareFunc{plataforma.ConPedido[stockapi.StrictHandlerFunc]},
			stockapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		stockapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	cuentasapi.HandlerWithOptions(
		cuentasapi.NewStrictHandlerWithOptions(cuentas.NuevaAPI(pool, clientes.Nuevo(pool, log), cobros.Nuevo(pool, log), cfg.Interna),
			[]cuentasapi.StrictMiddlewareFunc{plataforma.ConPedido[cuentasapi.StrictHandlerFunc]},
			cuentasapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		cuentasapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// Tanda 12: los PDF y las planillas (internal/documentos, internal/pdf).
	documentosapi.HandlerWithOptions(
		documentosapi.NewStrictHandlerWithOptions(documentos.NuevaAPI(pool, lim, log),
			[]documentosapi.StrictMiddlewareFunc{plataforma.ConPedido[documentosapi.StrictHandlerFunc]},
			documentosapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		documentosapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// Cortes: el plano, la cola del taller, las calculadoras y las rutas de
	// siempre del agente del taller (/api/cortes/...), que no cambian.
	apiCortes := cortes.NuevaAPI(cortes.Nuevo(pool, log), lim, cfg.Interna)
	apiCortes.Registrar(m)
	cortesapi.HandlerWithOptions(
		cortesapi.NewStrictHandlerWithOptions(apiCortes,
			[]cortesapi.StrictMiddlewareFunc{plataforma.ConPedido[cortesapi.StrictHandlerFunc]},
			cortesapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		cortesapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// Compras, proveedores y retenciones (tanda 8).
	comprasapi.HandlerWithOptions(
		comprasapi.NewStrictHandlerWithOptions(compras.NuevaAPI(compras.Nuevo(pool, log)),
			[]comprasapi.StrictMiddlewareFunc{plataforma.ConPedido[comprasapi.StrictHandlerFunc]},
			comprasapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		comprasapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// WhatsApp: la bandeja por el contrato, y el webhook de Meta, los adjuntos
	// y el envío de archivos con sus direcciones de siempre.
	wa := whatsapp.Nuevo(pool, cfg.WhatsApp, push.Nuevo(cfg.Push, q, log), log)
	wa.Rutas(m)
	whatsappapi.HandlerWithOptions(
		whatsappapi.NewStrictHandlerWithOptions(whatsapp.NuevaAPI(wa, cfg.Interna),
			[]whatsappapi.StrictMiddlewareFunc{plataforma.ConPedido[whatsappapi.StrictHandlerFunc]},
			whatsappapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		whatsappapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// La bitácora: quién hizo qué en el panel.
	bitacoraapi.HandlerWithOptions(
		bitacoraapi.NewStrictHandlerWithOptions(bitacora.NuevaAPI(pool),
			[]bitacoraapi.StrictMiddlewareFunc{plataforma.ConPedido[bitacoraapi.StrictHandlerFunc]},
			bitacoraapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		bitacoraapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// Mi cuenta: el portal del cliente.
	portalapi.HandlerWithOptions(
		portalapi.NewStrictHandlerWithOptions(portal.NuevaAPI(portal.Nuevo(pool)),
			[]portalapi.StrictMiddlewareFunc{plataforma.ConPedido[portalapi.StrictHandlerFunc]},
			portalapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		portalapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// «¿Existe esto?», para la caché de Next (con el secreto interno).
	existenciaapi.HandlerWithOptions(
		existenciaapi.NewStrictHandlerWithOptions(existencia.NuevaAPI(pool, cfg.Interna),
			[]existenciaapi.StrictMiddlewareFunc{plataforma.ConPedido[existenciaapi.StrictHandlerFunc]},
			existenciaapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		existenciaapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// Campañas, bajas y avisos (tanda 10): el contrato, y la baja con un clic
	// de los correos (POST /api/baja), con su dirección de siempre.
	correoT10 := email.Elegir(cfg.Email, log)
	pushT10 := push.Nuevo(cfg.Push, q, log)
	apiCampanas := campanas.NuevaAPI(campanas.Nuevo(pool, cfg.Campanas, correoT10, pushT10, log),
		avisos.Nuevo(pool, correoT10, cfg.Email.Remitente, log), pushT10, cfg.Push.Publica)
	apiCampanas.Registrar(m)
	campanasapi.HandlerWithOptions(
		campanasapi.NewStrictHandlerWithOptions(apiCampanas,
			[]campanasapi.StrictMiddlewareFunc{plataforma.ConPedido[campanasapi.StrictHandlerFunc]},
			campanasapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		campanasapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)
	// Profesionales y eventos (tanda 10).
	profesionalesapi.HandlerWithOptions(
		profesionalesapi.NewStrictHandlerWithOptions(profesionales.NuevaAPI(profesionales.Nuevo(pool,
			avisos.Nuevo(pool, correoT10, cfg.Email.Remitente, log), cfg.Campanas.URLDelSitio(), log), lim, cfg.Interna),
			[]profesionalesapi.StrictMiddlewareFunc{plataforma.ConPedido[profesionalesapi.StrictHandlerFunc]},
			profesionalesapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		profesionalesapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// El buscador del panel.
	buscadorapi.HandlerWithOptions(
		buscadorapi.NewStrictHandlerWithOptions(buscador.NuevaAPI(pool),
			[]buscadorapi.StrictMiddlewareFunc{plataforma.ConPedido[buscadorapi.StrictHandlerFunc]},
			buscadorapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		buscadorapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// Facturación electrónica con ARCA (tanda 7).
	facturacionapi.HandlerWithOptions(
		facturacionapi.NewStrictHandlerWithOptions(facturacion.NuevaAPI(facturacion.Nuevo(pool, log), cfg.Interna),
			[]facturacionapi.StrictMiddlewareFunc{plataforma.ConPedido[facturacionapi.StrictHandlerFunc]},
			facturacionapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		facturacionapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// El mostrador (tanda 5): las acciones de app/mostrador por el contrato, y
	// las rutas de siempre de la copia local (/api/mostrador/latido, catalogo,
	// clientes, caja/movimientos, caja/vincular) con su forma de siempre.
	servicioMostrador := mostrador.Nuevo(pool, log)
	servicioMostrador.Rutas(m)
	mostradorapi.HandlerWithOptions(
		mostradorapi.NewStrictHandlerWithOptions(mostrador.NuevaAPI(servicioMostrador),
			[]mostradorapi.StrictMiddlewareFunc{plataforma.ConPedido[mostradorapi.StrictHandlerFunc]},
			mostradorapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		mostradorapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// Pedidos y presupuestos del panel (tanda 5, parte B).
	ventasapi.HandlerWithOptions(
		ventasapi.NewStrictHandlerWithOptions(pedidos.NuevaAPI(pedidos.Nuevo(pool, log), cfg.Interna),
			[]ventasapi.StrictMiddlewareFunc{plataforma.ConPedido[ventasapi.StrictHandlerFunc]},
			ventasapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		ventasapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// Entregas, acopio, remitos, la firma y las zonas de envío (tanda 5).
	entregasapi.HandlerWithOptions(
		entregasapi.NewStrictHandlerWithOptions(entregas.NuevaAPI(entregas.Nuevo(pool, log), cfg.Interna),
			[]entregasapi.StrictMiddlewareFunc{plataforma.ConPedido[entregasapi.StrictHandlerFunc]},
			entregasapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		entregasapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// Tanda 5, parte D: la caja del panel, y los reportes, el cierre del mes
	// y el inicio del panel.
	cajaapi.HandlerWithOptions(
		cajaapi.NewStrictHandlerWithOptions(caja.NuevaPanelAPI(caja.NuevoPanel(pool, log)),
			[]cajaapi.StrictMiddlewareFunc{plataforma.ConPedido[cajaapi.StrictHandlerFunc]},
			cajaapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		cajaapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)
	reportesapi.HandlerWithOptions(
		reportesapi.NewStrictHandlerWithOptions(reportes.NuevaAPI(reportes.Nuevo(pool, log), cfg.Interna),
			[]reportesapi.StrictMiddlewareFunc{plataforma.ConPedido[reportesapi.StrictHandlerFunc]},
			reportesapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		reportesapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// La migración de ISIS (tanda 13).
	migracionapi.HandlerWithOptions(
		migracionapi.NewStrictHandlerWithOptions(migracion.NuevaAPI(migracion.Nuevo(pool, log)),
			[]migracionapi.StrictMiddlewareFunc{plataforma.ConPedido[migracionapi.StrictHandlerFunc]},
			migracionapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  plataforma.ErrorDePedido,
				ResponseErrorHandlerFunc: plataforma.ErrorDeRespuesta(log),
			}),
		migracionapi.StdHTTPServerOptions{BaseRouter: m, ErrorHandlerFunc: plataforma.ErrorDePedido},
	)

	// Cada pedido se valida contra el contrato de su dominio antes de llegar
	// al handler.
	var h http.Handler = m
	for _, spec := range []func() (*openapi3.T, error){sesionapi.GetSwagger, catalogoapi.GetSwagger, contenidoapi.GetSwagger, productosapi.GetSwagger, stockapi.GetSwagger, preciosapi.GetSwagger, cuentasapi.GetSwagger, bitacoraapi.GetSwagger, portalapi.GetSwagger, existenciaapi.GetSwagger, buscadorapi.GetSwagger, facturacionapi.GetSwagger} {
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
	// El contrato de los documentos (tanda 12), aparte para no tocar la
	// lista de arriba que comparten todas las tandas.
	if s, err := documentosapi.GetSwagger(); err != nil {
		return err
	} else if validar, err := plataforma.ValidarContra(s); err != nil {
		return err
	} else {
		h = validar(h)
	}

	// El contrato de cortes, en su propia línea para no pisar la lista de
	// arriba (cada tanda suma la suya).
	{
		s, err := cortesapi.GetSwagger()
		if err != nil {
			return err
		}
		validar, err := plataforma.ValidarContra(s)
		if err != nil {
			return err
		}
		h = validar(h)
	}

	// El contrato de compras (tanda 8), aparte para no tocar la lista de arriba.
	if s, err := comprasapi.GetSwagger(); err != nil {
		return err
	} else if validar, err := plataforma.ValidarContra(s); err != nil {
		return err
	} else {
		h = validar(h)
	}

	for _, spec := range []func() (*openapi3.T, error){whatsappapi.GetSwagger} {
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

	// El contrato de la tanda 10 (campañas y avisos), aparte.
	if s, err := campanasapi.GetSwagger(); err != nil {
		return err
	} else if validar, err := plataforma.ValidarContra(s); err != nil {
		return err
	} else {
		h = validar(h)
	}
	if s, err := profesionalesapi.GetSwagger(); err != nil {
		return err
	} else if validar, err := plataforma.ValidarContra(s); err != nil {
		return err
	} else {
		h = validar(h)
	}

	// El contrato del mostrador (tanda 5), aparte para no tocar las listas de arriba.
	if s, err := mostradorapi.GetSwagger(); err != nil {
		return err
	} else if validar, err := plataforma.ValidarContra(s); err != nil {
		return err
	} else {
		h = validar(h)
	}

	// El contrato de pedidos y presupuestos (tanda 5), aparte.
	if s, err := ventasapi.GetSwagger(); err != nil {
		return err
	} else if validar, err := plataforma.ValidarContra(s); err != nil {
		return err
	} else {
		h = validar(h)
	}

	// El contrato de entregas (tanda 5), aparte para no tocar las listas de
	// arriba.
	if s, err := entregasapi.GetSwagger(); err != nil {
		return err
	} else if validar, err := plataforma.ValidarContra(s); err != nil {
		return err
	} else {
		h = validar(h)
	}

	// Los contratos de la caja del panel y de los reportes (tanda 5, parte D).
	for _, spec := range []func() (*openapi3.T, error){cajaapi.GetSwagger, reportesapi.GetSwagger} {
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

	// El contrato de la migración (tanda 13), en su propia línea.
	if s, err := migracionapi.GetSwagger(); err != nil {
		return err
	} else if validar, err := plataforma.ValidarContra(s); err != nil {
		return err
	} else {
		h = validar(h)
	}

	// La sesión se lee en todos los pedidos de la API; /salud no la necesita
	// pero tampoco molesta (sin cookie no toca la base).
	return plataforma.Servir(cfg.Escuchar, plataforma.Cadena(sesiones.Middleware(h), log), log)
}
