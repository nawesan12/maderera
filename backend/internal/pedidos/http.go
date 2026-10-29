package pedidos

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"

	"mjbj/internal/api/ventasapi"
	"mjbj/internal/auth"
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

func (o respuesta) VisitListarPedidosResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitFichaDePedidoResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitAvanzarPedidoResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitCancelarPedidoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitMarcarPedidoCobradoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitListarPresupuestosResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCrearPresupuestoResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitFichaDePresupuestoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCambiarEstadoDePresupuestoResponse(w http.ResponseWriter) error {
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
	v, err := a.s.ListarPedidos(ctx, Filtros{texto(r.Params.Busqueda), texto(r.Params.Estado), texto(r.Params.Sucursal)})
	return ok(v), err
}

// FichaDePedido la lee todo el personal, como obtenerPedido: además del
// tablero la piden el ticket impreso y el alta de un corte (que también ve
// el aserradero).
func (a *API) FichaDePedido(ctx context.Context, r ventasapi.FichaDePedidoRequestObject) (ventasapi.FichaDePedidoResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
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

func (a *API) AvanzarPedido(ctx context.Context, r ventasapi.AvanzarPedidoRequestObject) (ventasapi.AvanzarPedidoResponseObject, error) {
	ses, err := pedidos(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.Avanzar(ctx, ses, r.Id.String())
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

func (a *API) MarcarPedidoCobrado(ctx context.Context, r ventasapi.MarcarPedidoCobradoRequestObject) (ventasapi.MarcarPedidoCobradoResponseObject, error) {
	ses, err := pedidos(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.MarcarPagado(ctx, ses, r.Id.String())
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
	v, err := a.s.ListarPresupuestos(ctx, Filtros{texto(r.Params.Busqueda), texto(r.Params.Estado), texto(r.Params.Sucursal)})
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
	v, err := a.s.ConvertirEnPedido(ctx, ses, r.Id.String())
	if err != nil {
		return nil, err
	}
	return ok(v), nil
}

// PresupuestoPdf: el personal, el cliente dueño o el servidor de Next. A
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
	if !interno && !ses.EsStaff() {
		propio, err := a.s.DuenoDeLaSesion(ctx, ses.UserID)
		if err != nil {
			return nil, err
		}
		if propio == nil || p.CustomerID == nil || *propio != *p.CustomerID {
			return nil, no
		}
	}
	b, err := a.s.PresupuestoPdf(ctx, p)
	if err != nil {
		return nil, err
	}
	return respuesta{pdf: b, nombre: p.Numero + ".pdf"}, nil
}
