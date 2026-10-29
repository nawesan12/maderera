package caja

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"mjbj/internal/api/cajaapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// PanelAPI son las rutas de api/caja.yaml (la caja del panel). El mostrador
// tiene las suyas.
type PanelAPI struct {
	p     *Panel
	ahora func() time.Time
}

// NuevaPanelAPI arma los handlers.
func NuevaPanelAPI(p *Panel) *PanelAPI { return &PanelAPI{p: p, ahora: time.Now} }

var _ cajaapi.StrictServerInterface = (*PanelAPI)(nil)

// respuestaPanel escribe JSON.
type respuestaPanel struct {
	codigo int
	v      any
}

func (o respuestaPanel) escribir(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func okPanel(v any) respuestaPanel { return respuestaPanel{codigo: http.StatusOK, v: v} }

func (o respuestaPanel) VisitListarCajasFisicasResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuestaPanel) VisitCrearCajaFisicaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuestaPanel) VisitDarDeBajaCajaFisicaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuestaPanel) VisitEmitidoPorCajaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuestaPanel) VisitSucursalesConCajaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuestaPanel) VisitGuardarFondoBaseResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuestaPanel) VisitTurnosCerradosResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuestaPanel) VisitTurnosParaAsignarResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuestaPanel) VisitVentasSinCajaResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuestaPanel) VisitAsignarVentaAlTurnoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

// pantallaDeCaja: quien entra a /admin/caja (el admin). El TS pedía solo ser
// personal en las acciones; la pantalla ya era del admin.
func pantallaDeCaja(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/caja")...)
}

func (a *PanelAPI) SucursalesConCaja(ctx context.Context, _ cajaapi.SucursalesConCajaRequestObject) (cajaapi.SucursalesConCajaResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := a.p.SucursalesConCaja(ctx)
	return okPanel(v), err
}

func (a *PanelAPI) GuardarFondoBase(ctx context.Context, r cajaapi.GuardarFondoBaseRequestObject) (cajaapi.GuardarFondoBaseResponseObject, error) {
	ses, err := pantallaDeCaja(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.p.GuardarFondoBase(ctx, ses, r.Id, r.Body.Monto)
	if err != nil {
		return nil, err
	}
	return okPanel(map[string]string{"ok": m}), nil
}

func (a *PanelAPI) TurnosCerrados(ctx context.Context, r cajaapi.TurnosCerradosRequestObject) (cajaapi.TurnosCerradosResponseObject, error) {
	if _, err := pantallaDeCaja(ctx); err != nil {
		return nil, err
	}
	limite := 30
	if r.Params.Limite != nil {
		limite = *r.Params.Limite
	}
	v, err := a.p.TurnosCerrados(ctx, limite)
	return okPanel(v), err
}

func (a *PanelAPI) ListarCajasFisicas(ctx context.Context, _ cajaapi.ListarCajasFisicasRequestObject) (cajaapi.ListarCajasFisicasResponseObject, error) {
	if _, err := pantallaDeCaja(ctx); err != nil {
		return nil, err
	}
	v, err := a.p.ListarCajasFisicas(ctx)
	return okPanel(v), err
}

func (a *PanelAPI) CrearCajaFisica(ctx context.Context, r cajaapi.CrearCajaFisicaRequestObject) (cajaapi.CrearCajaFisicaResponseObject, error) {
	ses, err := pantallaDeCaja(ctx)
	if err != nil {
		return nil, err
	}
	var cuerpo any
	if r.Body != nil {
		cuerpo = map[string]any(*r.Body)
	}
	c, err := a.p.CrearCaja(ctx, ses, cuerpo)
	if err != nil {
		return nil, err
	}
	return okPanel(map[string]string{"ok": "Caja creada. Ahora vinculala desde esa máquina.", "id": c.ID, "codigo": c.Codigo}), nil
}

func (a *PanelAPI) DarDeBajaCajaFisica(ctx context.Context, r cajaapi.DarDeBajaCajaFisicaRequestObject) (cajaapi.DarDeBajaCajaFisicaResponseObject, error) {
	ses, err := pantallaDeCaja(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.p.DarDeBajaCaja(ctx, ses, r.Id)
	if err != nil {
		return nil, err
	}
	return okPanel(map[string]string{"ok": m}), nil
}

func (a *PanelAPI) VentasSinCaja(ctx context.Context, _ cajaapi.VentasSinCajaRequestObject) (cajaapi.VentasSinCajaResponseObject, error) {
	if _, err := pantallaDeCaja(ctx); err != nil {
		return nil, err
	}
	v, err := a.p.VentasSinCaja(ctx)
	return okPanel(v), err
}

func (a *PanelAPI) AsignarVentaAlTurno(ctx context.Context, r cajaapi.AsignarVentaAlTurnoRequestObject) (cajaapi.AsignarVentaAlTurnoResponseObject, error) {
	ses, err := pantallaDeCaja(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.p.AsignarVentaAlTurno(ctx, ses, r.Id, r.Body.SessionId)
	if err != nil {
		return nil, err
	}
	return okPanel(map[string]string{"ok": m}), nil
}

func (a *PanelAPI) TurnosParaAsignar(ctx context.Context, r cajaapi.TurnosParaAsignarRequestObject) (cajaapi.TurnosParaAsignarResponseObject, error) {
	if _, err := pantallaDeCaja(ctx); err != nil {
		return nil, err
	}
	v, err := a.p.TurnosParaAsignar(ctx, r.Params.Sucursal)
	return okPanel(v), err
}

func (a *PanelAPI) EmitidoPorCaja(ctx context.Context, r cajaapi.EmitidoPorCajaRequestObject) (cajaapi.EmitidoPorCajaResponseObject, error) {
	if _, err := pantallaDeCaja(ctx); err != nil {
		return nil, err
	}
	periodo := ""
	if r.Params.Periodo != nil {
		periodo = *r.Params.Periodo
	}
	desde, hasta := MesArgentino(periodo, a.ahora())
	v, err := a.p.EmitidoPorCaja(ctx, desde, hasta)
	return okPanel(v), err
}
