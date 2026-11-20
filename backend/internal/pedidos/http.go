package pedidos

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"

	"mjbj/internal/api/ventasapi"
	"mjbj/internal/auth"
	"mjbj/internal/cobros"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

// API son las rutas de api/ventas.yaml.
type API struct {
	s       *Servicio
	interna plataforma.ConfigInterna
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, interna plataforma.ConfigInterna) *API {
	return &API{s: s, interna: interna}
}

var _ ventasapi.StrictServerInterface = (*API)(nil)

type respuesta struct {
	codigo int
	v      any
	pdf    []byte
	nombre string
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	if o.pdf != nil {
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `attachment; filename="`+o.nombre+`"`)
		w.Header().Set("Cache-Control", "private, no-store")
		w.WriteHeader(http.StatusOK)
		_, err := bytes.NewReader(o.pdf).WriteTo(w)
		return err
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta { return respuesta{codigo: http.StatusOK, v: v} }

func (o respuesta) VisitListarPedidosResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCambiarEntregaDelPedidoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitFichaDePedidoResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitPedidoParaElTallerResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAvanzarPedidoResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitCancelarPedidoResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitCobrarPedidoResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitListarPresupuestosResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCrearPresupuestoResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitFichaDePresupuestoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCambiarEstadoDePresupuestoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitUnirPedidoAFichaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitUnirPresupuestoAFichaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitConvertirPresupuestoEnPedidoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitPresupuestoPdfResponse(w http.ResponseWriter) error { return o.escribir(w) }

// Los permisos: los de cada pantalla.
func pedidos(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/pedidos")...)
}
func presupuestos(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/presupuestos")...)
}

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

/* -------------------------------- pedidos -------------------------------- */

func (a *API) ListarPedidos(ctx context.Context, r ventasapi.ListarPedidosRequestObject) (ventasapi.ListarPedidosResponseObject, error) {
	if _, err := pedidos(ctx); err != nil {
		return nil, err
	}
	vista := VistaDePedidos{}
	if r.Params.Vista != nil {
		vista.Vista = string(*r.Params.Vista)
	}
	if r.Params.Desde != nil {
		vista.Desde = r.Params.Desde.Format("2006-01-02")
	}
	if r.Params.Hasta != nil {
		vista.Hasta = r.Params.Hasta.Format("2006-01-02")
	}
	if r.Params.Pagina != nil {
		vista.Pagina = *r.Params.Pagina
	}
	v, err := a.s.ListarPedidosEn(ctx, Filtros{texto(r.Params.Busqueda), texto(r.Params.Estado), texto(r.Params.Sucursal)}, vista)
	return ok(v), err
}

// FichaDePedido la lee quien entra a Pedidos (el tablero y el ticket
// impreso). El aserradero la leía para cargar el corte de un pedido, y con
// ella los precios, el saldo, el mail y el teléfono del cliente: ahora usa
// PedidoParaElTaller (T3, hallazgo 40).
func (a *API) FichaDePedido(ctx context.Context, r ventasapi.FichaDePedidoRequestObject) (ventasapi.FichaDePedidoResponseObject, error) {
	ses, err := pedidos(ctx)
	if err != nil {
		return nil, err
	}
	p, err := a.s.Pedido(ctx, r.Id.String(), ses.Tiene(sqlc.StaffRoleAdmin))
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, noEsta("No se encontró el pedido.")
	}
	return ok(p), nil
}

// PedidoParaElTaller: todo el personal (el aserradero carga el corte de un
// pedido desde /admin/cortes/nuevo). Sin plata ni datos de contacto.
func (a *API) PedidoParaElTaller(ctx context.Context, r ventasapi.PedidoParaElTallerRequestObject) (ventasapi.PedidoParaElTallerResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	p, err := a.s.ParaElTaller(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, noEsta("No se encontró el pedido.")
	}
	return ok(p), nil
}

func (a *API) AvanzarPedido(ctx context.Context, r ventasapi.AvanzarPedidoRequestObject) (ventasapi.AvanzarPedidoResponseObject, error) {
	ses, err := pedidos(ctx)
	if err != nil {
		return nil, err
	}
	desde := ""
	if r.Params.Desde != nil {
		desde = *r.Params.Desde
	}
	v, err := a.s.Avanzar(ctx, ses, r.Id.String(), desde)
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

func (a *API) CancelarPedido(ctx context.Context, r ventasapi.CancelarPedidoRequestObject) (ventasapi.CancelarPedidoResponseObject, error) {
	ses, err := pedidos(ctx)
	if err != nil {
		return nil, err
	}
	var motivo *string
	if r.Body != nil {
		motivo = r.Body.Motivo
	}
	v, err := a.s.Cancelar(ctx, ses, r.Id.String(), motivo)
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

// CobrarPedido: quien mueve plata (roles.ManejanPlata). El depósito abre
// la ficha pero no cobra. Reemplaza a «marcar cobrado» (T3, hallazgo 5).
func (a *API) CobrarPedido(ctx context.Context, r ventasapi.CobrarPedidoRequestObject) (ventasapi.CobrarPedidoResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.ManejanPlata...)
	if err != nil {
		return nil, err
	}
	v, err := cobros.Nuevo(a.s.pool, a.s.log).CobrarPedido(ctx, ses, r.Id.String(), r.Body.Partes, texto(r.Body.Clave), texto(r.Body.BranchId))
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

/* ------------------------------ presupuestos ------------------------------ */

func (a *API) ListarPresupuestos(ctx context.Context, r ventasapi.ListarPresupuestosRequestObject) (ventasapi.ListarPresupuestosResponseObject, error) {
	if _, err := presupuestos(ctx); err != nil {
		return nil, err
	}
	p := r.Params
	limite, desplazamiento := 0, 0
	if p.Limite != nil {
		limite = *p.Limite
	}
	if p.Desplazamiento != nil {
		desplazamiento = *p.Desplazamiento
	}
	v, err := a.s.ListarPresupuestos(ctx, Filtros{texto(p.Busqueda), texto(p.Estado), texto(p.Sucursal)}, limite, desplazamiento)
	return ok(v), err
}

func (a *API) CrearPresupuesto(ctx context.Context, r ventasapi.CrearPresupuestoRequestObject) (ventasapi.CrearPresupuestoResponseObject, error) {
	ses, err := presupuestos(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	v, err := a.s.CrearPresupuesto(ctx, ses, b.Cabecera, b.Lineas, b.Convertir != nil && *b.Convertir)
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

// FichaDePresupuesto: quien entra a la pantalla, o el servidor de Next con
// el secreto (manda el PDF por WhatsApp a su dueño).
func (a *API) FichaDePresupuesto(ctx context.Context, r ventasapi.FichaDePresupuestoRequestObject) (ventasapi.FichaDePresupuestoResponseObject, error) {
	if !a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
		if _, err := presupuestos(ctx); err != nil {
			return nil, err
		}
	}
	p, err := a.s.Presupuesto(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, noEsta("No se encontró el presupuesto.")
	}
	return ok(p), nil
}

// UnirPedidoAFicha y UnirPresupuestoAFicha: quien entra a Clientes (unir es
// tocar el historial de una ficha), ver unir.go.
func (a *API) UnirPedidoAFicha(ctx context.Context, r ventasapi.UnirPedidoAFichaRequestObject) (ventasapi.UnirPedidoAFichaResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...)
	if err != nil {
		return nil, err
	}
	m, err := a.s.UnirAFicha(ctx, ses, "orders", r.Id.String(), r.Body.CustomerId)
	if err != nil {
		return nil, err
	}
	return ok(Resultado{Ok: m}), nil
}

func (a *API) UnirPresupuestoAFicha(ctx context.Context, r ventasapi.UnirPresupuestoAFichaRequestObject) (ventasapi.UnirPresupuestoAFichaResponseObject, error) {
	ses, err := auth.Exigir(ctx, roles.QuienEntra("/admin/clientes")...)
	if err != nil {
		return nil, err
	}
	m, err := a.s.UnirAFicha(ctx, ses, "quotes", r.Id.String(), r.Body.CustomerId)
	if err != nil {
		return nil, err
	}
	return ok(Resultado{Ok: m}), nil
}

func (a *API) CambiarEstadoDePresupuesto(ctx context.Context, r ventasapi.CambiarEstadoDePresupuestoRequestObject) (ventasapi.CambiarEstadoDePresupuestoResponseObject, error) {
	ses, err := presupuestos(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.CambiarEstadoPresupuesto(ctx, ses, r.Id.String(), r.Body.Estado)
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

func (a *API) ConvertirPresupuestoEnPedido(ctx context.Context, r ventasapi.ConvertirPresupuestoEnPedidoRequestObject) (ventasapi.ConvertirPresupuestoEnPedidoResponseObject, error) {
	ses, err := presupuestos(ctx)
	if err != nil {
		return nil, err
	}
	var ent Entrega
	if b := r.Body; b != nil {
		ent.Envio = b.TipoEntrega != nil && *b.TipoEntrega == ventasapi.Envio
		ent.Direccion = texto(b.Direccion)
		ent.Zona = texto(b.Zona)
		if b.CostoEnvio != nil {
			ent.CostoEnvio = *b.CostoEnvio
		}
		if b.MedioPago != nil {
			m := string(*b.MedioPago)
			ent.MedioPago = &m
		}
		ent.EntregarEl = texto(b.EntregarEl)
		if b.Precios != nil {
			ent.Precios = string(*b.Precios)
		}
		ent.PIN, ent.Ficha = texto(b.Pin), texto(b.Ficha)
	}
	v, err := a.s.ConvertirConEntrega(ctx, ses, r.Id.String(), ent)
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

// PresupuestoPdf: el personal de presupuestos o del mostrador, el cliente dueño o el servidor de Next. A
// cualquier otro, 404.
func (a *API) PresupuestoPdf(ctx context.Context, r ventasapi.PresupuestoPdfRequestObject) (ventasapi.PresupuestoPdfResponseObject, error) {
	no := noEsta("No encontrado")
	interno := a.interna.EsInterno(plataforma.PedidoDe(ctx))
	ses := auth.DeContexto(ctx)
	if ses == nil && !interno {
		return nil, no
	}
	p, err := a.s.Presupuesto(ctx, r.Id.String())
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, no
	}
	// Del personal, quien arma o vende presupuestos (antes, también el
	// aserradero y el depósito: precios y datos del cliente).
	if !interno && ses.EsStaff() && !ses.Tiene(append(roles.QuienEntra("/admin/presupuestos"), roles.QuienEntra("/mostrador")...)...) {
		return nil, no
	}
	if !interno && !ses.EsStaff() {
		propio, err := a.s.DuenoDeLaSesion(ctx, ses.UserID)
		if err != nil {
			return nil, err
		}
		if propio == nil || p.CustomerID == nil || *propio != *p.CustomerID {
			return nil, no
		}
		// El que armó el bot de WhatsApp lo ve el cliente recién cuando una
		// persona lo revisó y lo mandó.
		if p.Origen == "whatsapp" && p.Estado == "revision" {
			return nil, no
		}
	}
	b, err := a.s.PresupuestoPdf(ctx, p)
	if err != nil {
		return nil, err
	}
	return respuesta{pdf: b, nombre: p.Numero + ".pdf"}, nil
}

func (a *API) CambiarEntregaDelPedido(ctx context.Context, r ventasapi.CambiarEntregaDelPedidoRequestObject) (ventasapi.CambiarEntregaDelPedidoResponseObject, error) {
	ses, err := presupuestos(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.CambiarEntrega(ctx, ses, r.Id.String(), r.Body.EntregarEl)
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}
