package checkout

import (
	"context"
	"encoding/json"
	"net/http"

	"mjbj/internal/api/checkoutapi"
	"mjbj/internal/auth"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
)

// API son las rutas de api/checkout.yaml.
type API struct {
	s       *Servicio
	interna plataforma.ConfigInterna
	// CookieSegura: la cookie del carrito lleva Secure (en producción, con
	// https).
	cookieSegura bool
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, interna plataforma.ConfigInterna, cookieSegura bool) *API {
	return &API{s: s, interna: interna, cookieSegura: cookieSegura}
}

var _ checkoutapi.StrictServerInterface = (*API)(nil)

type respuesta struct {
	codigo int
	v      any
	cookie *http.Cookie
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	if o.cookie != nil {
		http.SetCookie(w, o.cookie)
	}
	if o.v == nil {
		w.WriteHeader(o.codigo)
		return nil
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func (o respuesta) VisitMiCarritoResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitVaciarCarritoResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitConfirmarCompraResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAgregarCorteAlCarritoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitQuitarCorteDelCarritoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitAgregarAlCarritoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAgregarVariosAlCarritoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitQuitarDelCarritoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitCambiarCantidadDelCarritoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitActualizarPreciosDelCarritoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitPedirPresupuestoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitQuitarLosQueSeCotizanResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitAdoptarCarritoResponse(w http.ResponseWriter) error { return o.escribir(w) }

// quien es la sesión y la cookie del carrito.
func quien(ctx context.Context) Quien {
	q := Quien{Ses: auth.DeContexto(ctx)}
	if r := plataforma.PedidoDe(ctx); r != nil {
		if c, err := r.Cookie(CookieCarrito); err == nil {
			q.Token = c.Value
		}
	}
	return q
}

func ip(ctx context.Context) string { return plataforma.IPDelCliente(plataforma.PedidoDe(ctx)) }

// conCookie contesta el resultado y, si se creó el carrito, la cookie:
// dos meses, httpOnly y lax (un presupuesto de obra se piensa).
func (a *API) conCookie(r Resultado, err error) (respuesta, error) {
	if err != nil {
		return respuesta{}, err
	}
	o := respuesta{codigo: http.StatusOK, v: r}
	if r.TokenNuevo != "" {
		o.cookie = &http.Cookie{Name: CookieCarrito, Value: r.TokenNuevo, Path: "/", MaxAge: 60 * 60 * 24 * 60,
			HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: a.cookieSegura}
	}
	return o, nil
}

func (a *API) MiCarrito(ctx context.Context, _ checkoutapi.MiCarritoRequestObject) (checkoutapi.MiCarritoResponseObject, error) {
	c, err := a.s.Obtener(ctx, quien(ctx))
	if err != nil {
		return nil, err
	}
	return respuesta{codigo: http.StatusOK, v: c}, nil
}

func (a *API) AgregarAlCarrito(ctx context.Context, r checkoutapi.AgregarAlCarritoRequestObject) (checkoutapi.AgregarAlCarritoResponseObject, error) {
	return a.conCookie(a.s.Agregar(ctx, quien(ctx), map[string]any(*r.Body)))
}

func (a *API) AgregarVariosAlCarrito(ctx context.Context, r checkoutapi.AgregarVariosAlCarritoRequestObject) (checkoutapi.AgregarVariosAlCarritoResponseObject, error) {
	return a.conCookie(a.s.AgregarVarios(ctx, quien(ctx), r.Body.Items))
}

func (a *API) CambiarCantidadDelCarrito(ctx context.Context, r checkoutapi.CambiarCantidadDelCarritoRequestObject) (checkoutapi.CambiarCantidadDelCarritoResponseObject, error) {
	cantidad := 0.0
	if r.Body != nil && r.Body.Cantidad != nil {
		cantidad = *r.Body.Cantidad
	}
	return a.conCookie(a.s.CambiarCantidad(ctx, quien(ctx), r.Id.String(), cantidad))
}

func (a *API) QuitarDelCarrito(ctx context.Context, r checkoutapi.QuitarDelCarritoRequestObject) (checkoutapi.QuitarDelCarritoResponseObject, error) {
	return a.conCookie(a.s.Quitar(ctx, quien(ctx), r.Id.String()))
}

func (a *API) VaciarCarrito(ctx context.Context, _ checkoutapi.VaciarCarritoRequestObject) (checkoutapi.VaciarCarritoResponseObject, error) {
	return a.conCookie(a.s.Vaciar(ctx, quien(ctx)))
}

func (a *API) ActualizarPreciosDelCarrito(ctx context.Context, _ checkoutapi.ActualizarPreciosDelCarritoRequestObject) (checkoutapi.ActualizarPreciosDelCarritoResponseObject, error) {
	return a.conCookie(a.s.ActualizarPrecios(ctx, quien(ctx)))
}

func (a *API) QuitarLosQueSeCotizan(ctx context.Context, _ checkoutapi.QuitarLosQueSeCotizanRequestObject) (checkoutapi.QuitarLosQueSeCotizanResponseObject, error) {
	if err := a.s.QuitarLosQueSeCotizan(ctx, quien(ctx)); err != nil {
		return nil, err
	}
	return respuesta{codigo: http.StatusNoContent}, nil
}

func (a *API) AgregarCorteAlCarrito(ctx context.Context, r checkoutapi.AgregarCorteAlCarritoRequestObject) (checkoutapi.AgregarCorteAlCarritoResponseObject, error) {
	// El freno de la cotización del corte: el trabajo más caro desde afuera.
	if v := a.s.lim.Permitido(ctx, limites.Corte, "ip:"+ip(ctx)); !v.Permitido {
		return nil, espera(v)
	}
	return a.conCookie(a.s.AgregarCorte(ctx, quien(ctx), map[string]any(*r.Body)))
}

func (a *API) QuitarCorteDelCarrito(ctx context.Context, r checkoutapi.QuitarCorteDelCarritoRequestObject) (checkoutapi.QuitarCorteDelCarritoResponseObject, error) {
	return a.conCookie(a.s.QuitarCorte(ctx, quien(ctx), r.Id))
}

func (a *API) PedirPresupuesto(ctx context.Context, r checkoutapi.PedirPresupuestoRequestObject) (checkoutapi.PedirPresupuestoResponseObject, error) {
	p, err := a.s.PedirPresupuesto(ctx, quien(ctx), ip(ctx), map[string]any(*r.Body))
	if err != nil {
		return nil, err
	}
	return respuesta{codigo: http.StatusOK, v: p}, nil
}

func (a *API) ConfirmarCompra(ctx context.Context, r checkoutapi.ConfirmarCompraRequestObject) (checkoutapi.ConfirmarCompraResponseObject, error) {
	c, err := a.s.Confirmar(ctx, quien(ctx), ip(ctx), map[string]any(*r.Body))
	if err != nil {
		return nil, err
	}
	return respuesta{codigo: http.StatusOK, v: c}, nil
}

func (a *API) AdoptarCarrito(ctx context.Context, r checkoutapi.AdoptarCarritoRequestObject) (checkoutapi.AdoptarCarritoResponseObject, error) {
	if !a.interna.EsInterno(plataforma.PedidoDe(ctx)) {
		return nil, plataforma.NuevoProblema(http.StatusForbidden, "Solo el servidor.")
	}
	if err := a.s.Adoptar(ctx, r.Body.UserId, r.Body.Token); err != nil {
		return nil, err
	}
	return respuesta{codigo: http.StatusNoContent}, nil
}
