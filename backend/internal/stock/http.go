package stock

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"mjbj/internal/api/stockapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// API son las rutas de api/stock.yaml.
type API struct{ s *Servicio }

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio) *API { return &API{s: s} }

var _ stockapi.StrictServerInterface = (*API)(nil)

type respuesta struct {
	codigo int
	v      any
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	if o.codigo == http.StatusNoContent {
		w.WriteHeader(o.codigo)
		return nil
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta { return respuesta{http.StatusOK, v} }

func (o respuesta) VisitGrillaDeStockResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitAlertasDeStockResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitUltimosMovimientosResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAjustarStockResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitTransferirStockResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitSucursalesDelPanelResponse(w http.ResponseWriter) error { return o.escribir(w) }

func gestion(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/stock")...)
}

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func entero(p *int, def int) int {
	if p == nil {
		return def
	}
	return *p
}

func (a *API) GrillaDeStock(ctx context.Context, r stockapi.GrillaDeStockRequestObject) (stockapi.GrillaDeStockResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Listar(ctx, texto(r.Params.Busqueda), texto(r.Params.Categoria))
	return ok(v), err
}

func (a *API) AlertasDeStock(ctx context.Context, r stockapi.AlertasDeStockRequestObject) (stockapi.AlertasDeStockResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Alertas(ctx, entero(r.Params.Limite, 8))
	return ok(v), err
}

func (a *API) UltimosMovimientos(ctx context.Context, r stockapi.UltimosMovimientosRequestObject) (stockapi.UltimosMovimientosResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.Movimientos(ctx, entero(r.Params.Limite, 10))
	return ok(v), err
}

func (a *API) AjustarStock(ctx context.Context, r stockapi.AjustarStockRequestObject) (stockapi.AjustarStockResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.Ajustar(ctx, ses, r.Body.VariantId, r.Body.BranchSlug, float64(r.Body.Cantidad))
	if err != nil {
		return nil, err
	}
	if m == "" {
		return ok(map[string]string{}), nil
	}
	return ok(map[string]string{"ok": m}), nil
}

func (a *API) TransferirStock(ctx context.Context, r stockapi.TransferirStockRequestObject) (stockapi.TransferirStockResponseObject, error) {
	ses, err := gestion(ctx)
	if err != nil {
		return nil, err
	}
	b := r.Body
	if err := a.s.Transferir(ctx, ses, FormTransferencia{b.VariantId, b.OrigenId, b.DestinoId, b.Cantidad, texto(b.Nota)}); err != nil {
		return nil, err
	}
	return respuesta{codigo: http.StatusNoContent}, nil
}

func (a *API) SucursalesDelPanel(ctx context.Context, _ stockapi.SucursalesDelPanelRequestObject) (stockapi.SucursalesDelPanelResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	filas, err := a.s.q.SucursalesTodas(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, len(filas))
	for i, b := range filas {
		out[i] = map[string]any{"id": b.ID, "slug": b.Slug, "name": b.Name, "sortOrder": b.SortOrder, "active": b.Active,
			"createdAt": b.CreatedAt, "fondoBase": strconv.FormatFloat(float64(b.FondoBase), 'f', 2, 64)}
	}
	return ok(out), nil
}

func (o respuesta) VisitMetricasDeSucursalesResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitSinSucursalAsignadaResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}

func (a *API) MetricasDeSucursales(ctx context.Context, _ stockapi.MetricasDeSucursalesRequestObject) (stockapi.MetricasDeSucursalesResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.MetricasPorSucursal(ctx, time.Now())
	return ok(v), err
}

func (a *API) SinSucursalAsignada(ctx context.Context, _ stockapi.SinSucursalAsignadaRequestObject) (stockapi.SinSucursalAsignadaResponseObject, error) {
	if _, err := auth.ExigirStaff(ctx); err != nil {
		return nil, err
	}
	p, c, err := a.s.SinSucursal(ctx)
	return ok(map[string]int{"pedidos": p, "cortes": c}), err
}
