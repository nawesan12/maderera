package portal

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"mjbj/internal/api/portalapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
)

// API son las rutas de api/portal.yaml.
type API struct{ s *Servicio }

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio) *API { return &API{s: s} }

var _ portalapi.StrictServerInterface = (*API)(nil)

type respuesta struct{ v any }

func (o respuesta) escribir(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func (o respuesta) VisitMiFichaResponse(w http.ResponseWriter) error         { return o.escribir(w) }
func (o respuesta) VisitMiResumenResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitMisPedidosResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitMisPresupuestosResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitMiPresupuestoResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitResponderPresupuestoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitGuardarMisDatosResponse(w http.ResponseWriter) error  { return o.escribir(w) }
func (o respuesta) VisitMisDireccionesResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitGuardarDireccionResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitBorrarDireccionResponse(w http.ResponseWriter) error  { return o.escribir(w) }

func hecho(m string) respuesta { return respuesta{map[string]string{"ok": m}} }

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// cliente es la ficha de la sesión para leer: nil sin sesión o sin ficha.
func (a *API) cliente(ctx context.Context) (*Cliente, error) {
	ses := auth.DeContexto(ctx)
	if ses == nil {
		return nil, nil
	}
	return a.s.ClienteDe(ctx, ses.UserID)
}

// paraCambiar pide sesión, y la ficha.
func (a *API) paraCambiar(ctx context.Context) (*auth.Sesion, *Cliente, error) {
	ses, err := auth.Exigir(ctx)
	if err != nil {
		return nil, nil, err
	}
	c, err := a.s.ClienteDe(ctx, ses.UserID)
	if err != nil {
		return nil, nil, err
	}
	if c == nil {
		return nil, nil, plataforma.Invalido(map[string]string{"cliente": "No encontramos tu ficha de cliente."})
	}
	return ses, c, nil
}

func (a *API) MiFicha(ctx context.Context, _ portalapi.MiFichaRequestObject) (portalapi.MiFichaResponseObject, error) {
	c, err := a.cliente(ctx)
	return respuesta{map[string]any{"cliente": c}}, err
}

func (a *API) MiResumen(ctx context.Context, _ portalapi.MiResumenRequestObject) (portalapi.MiResumenResponseObject, error) {
	c, err := a.cliente(ctx)
	if err != nil || c == nil {
		return respuesta{Resumen{}}, err
	}
	r, err := a.s.ResumenDe(ctx, c)
	return respuesta{r}, err
}

func (a *API) MisPedidos(ctx context.Context, _ portalapi.MisPedidosRequestObject) (portalapi.MisPedidosResponseObject, error) {
	c, err := a.cliente(ctx)
	if err != nil || c == nil {
		return respuesta{[]Pedido{}}, err
	}
	v, err := a.s.Pedidos(ctx, c)
	return respuesta{v}, err
}

func (a *API) MisPresupuestos(ctx context.Context, _ portalapi.MisPresupuestosRequestObject) (portalapi.MisPresupuestosResponseObject, error) {
	c, err := a.cliente(ctx)
	if err != nil || c == nil {
		return respuesta{[]Presupuesto{}}, err
	}
	v, err := a.s.Presupuestos(ctx, c)
	return respuesta{v}, err
}

func (a *API) MiPresupuesto(ctx context.Context, r portalapi.MiPresupuestoRequestObject) (portalapi.MiPresupuestoResponseObject, error) {
	c, err := a.cliente(ctx)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, plataforma.NuevoProblema(http.StatusNotFound, "Ese presupuesto no está.")
	}
	p, err := a.s.PresupuestoDe(ctx, c, r.Numero)
	if errors.Is(err, ErrNoEsta) {
		return nil, plataforma.NuevoProblema(http.StatusNotFound, "Ese presupuesto no está.")
	}
	return respuesta{p}, err
}

func (a *API) ResponderPresupuesto(ctx context.Context, r portalapi.ResponderPresupuestoRequestObject) (portalapi.ResponderPresupuestoResponseObject, error) {
	_, c, err := a.paraCambiar(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.Responder(ctx, c, r.Numero, r.Body.Respuesta)
	if err != nil {
		return nil, err
	}
	return hecho(m), nil
}

func (a *API) GuardarMisDatos(ctx context.Context, r portalapi.GuardarMisDatosRequestObject) (portalapi.GuardarMisDatosResponseObject, error) {
	ses, c, err := a.paraCambiar(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	if err := a.s.GuardarDatos(ctx, ses.UserID, c, FormDatos{Nombre: texto(b.Nombre), Telefono: texto(b.Telefono), RazonSocial: texto(b.RazonSocial),
		Cuit: texto(b.Cuit), CondicionIva: texto(b.CondicionIva)}); err != nil {
		return nil, err
	}
	return hecho("Guardamos tus datos."), nil
}

func (a *API) MisDirecciones(ctx context.Context, _ portalapi.MisDireccionesRequestObject) (portalapi.MisDireccionesResponseObject, error) {
	c, err := a.cliente(ctx)
	if err != nil || c == nil {
		return respuesta{[]Direccion{}}, err
	}
	v, err := a.s.Direcciones(ctx, c)
	return respuesta{v}, err
}

func (a *API) GuardarDireccion(ctx context.Context, r portalapi.GuardarDireccionRequestObject) (portalapi.GuardarDireccionResponseObject, error) {
	_, c, err := a.paraCambiar(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	if err := a.s.GuardarDireccion(ctx, c, FormDireccion{ID: texto(b.Id), Etiqueta: texto(b.Etiqueta), Calle: texto(b.Calle),
		Localidad: texto(b.Localidad), CodigoPostal: texto(b.CodigoPostal), Notas: texto(b.Notas),
		Predeterminada: b.Predeterminada != nil && *b.Predeterminada}); err != nil {
		return nil, err
	}
	return hecho("Dirección guardada."), nil
}

func (a *API) BorrarDireccion(ctx context.Context, r portalapi.BorrarDireccionRequestObject) (portalapi.BorrarDireccionResponseObject, error) {
	_, c, err := a.paraCambiar(ctx)
	if err != nil {
		return nil, err
	}
	if err := a.s.BorrarDireccion(ctx, c, r.Id); err != nil {
		return nil, err
	}
	return hecho("Dirección eliminada."), nil
}
