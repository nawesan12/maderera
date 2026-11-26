package compras

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/api/comprasapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
)

// Las rutas que sumó el mes simulado (noviembre de 2026).

func (o respuesta) VisitAplicarNotaDeCreditoResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitEditarOrdenDeCompraResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitOrdenesPorRecibirResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitEditarRecepcionResponse(w http.ResponseWriter) error   { return o.escribir(w) }

// veCostos dice si la sesión ve lo que cuesta la mercadería: el depósito
// recibe el camión (mes simulado, H097) pero no ve precios.
func veCostos(ses *auth.Sesion) bool {
	return ses != nil && ses.RolStaff != nil && roles.PuedeEntrar("/admin/recepciones/nueva", ses.RolStaff)
}

// recepcionesConCostos es quien carga una recepción a mano, con sus costos,
// y la anula.
func recepcionesConCostos(ctx context.Context) (*auth.Sesion, error) {
	return admin(ctx, "/admin/recepciones/nueva")
}

func (a *API) EditarOrdenDeCompra(ctx context.Context, r comprasapi.EditarOrdenDeCompraRequestObject) (comprasapi.EditarOrdenDeCompraResponseObject, error) {
	ses, err := compras(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.EditarOrden(ctx, ses, r.Id, *r.Body)
	if err != nil {
		return nil, err
	}
	return hecho(m), nil
}

func (a *API) EditarRecepcion(ctx context.Context, r comprasapi.EditarRecepcionRequestObject) (comprasapi.EditarRecepcionResponseObject, error) {
	ses, err := recepciones(ctx)
	if err != nil {
		return nil, err
	}
	cuerpo := map[string]any(*r.Body)
	if !veCostos(ses) {
		// Sin precios, solo las cantidades: el costo y el flete quedan.
		cuerpo, err = a.s.conCostosGuardados(ctx, r.Id, cuerpo)
		if err != nil {
			return nil, err
		}
	}
	m, err := a.s.EditarRecepcion(ctx, ses, r.Id, cuerpo)
	if err != nil {
		return nil, err
	}
	return hecho(m), nil
}

func (a *API) OrdenesPorRecibir(ctx context.Context, _ comprasapi.OrdenesPorRecibirRequestObject) (comprasapi.OrdenesPorRecibirResponseObject, error) {
	if _, err := recepciones(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.OrdenesPorRecibir(ctx)
	return ok(v), err
}

func (a *API) AplicarNotaDeCredito(ctx context.Context, r comprasapi.AplicarNotaDeCreditoRequestObject) (comprasapi.AplicarNotaDeCreditoResponseObject, error) {
	ses, err := compras(ctx)
	if err != nil {
		return nil, err
	}
	m, err := a.s.AplicarNotaDeCredito(ctx, ses, r.Id, r.Body.FacturaId)
	if err != nil {
		return nil, err
	}
	return hecho(m), nil
}

// conCostosGuardados completa cada renglón con el costo que ya tenía y el
// flete con el de la recepción: lo que manda el depósito no los trae.
func (s *Servicio) conCostosGuardados(ctx context.Context, id string, m map[string]any) (map[string]any, error) {
	if !plataforma.UUIDValido(id) {
		return m, nil
	}
	costos := map[string]string{}
	filas, err := s.pool.Query(ctx, `SELECT id::text, costo_unitario::text FROM goods_receipt_items WHERE receipt_id = $1`, id)
	if err != nil {
		return nil, err
	}
	for filas.Next() {
		var i, c string
		if err := filas.Scan(&i, &c); err != nil {
			filas.Close()
			return nil, err
		}
		costos[i] = c
	}
	filas.Close()
	var gastos string
	if err := s.pool.QueryRow(ctx, `SELECT gastos::text FROM goods_receipts WHERE id = $1`, id).Scan(&gastos); err != nil && err != pgx.ErrNoRows {
		return nil, err
	}
	out := map[string]any{"gastos": gastos}
	var lineas []any
	if l, ok := m["lineas"].([]any); ok {
		for _, x := range l {
			r, _ := x.(map[string]any)
			if r == nil {
				continue
			}
			copia := map[string]any{"id": r["id"], "cantidad": r["cantidad"]}
			if i, _ := r["id"].(string); costos[i] != "" {
				copia["costoUnitario"] = costos[i]
			} else {
				copia["costoUnitario"] = 0
			}
			lineas = append(lineas, copia)
		}
	}
	out["lineas"] = lineas
	return out, nil
}

// PorRecibir es una orden que se espera, sin importes.
type PorRecibir struct {
	ID             string     `json:"id"`
	Numero         string     `json:"numero"`
	Estado         string     `json:"estado"`
	Proveedor      string     `json:"proveedor"`
	Sucursal       *string    `json:"sucursal"`
	FechaPrometida *time.Time `json:"fechaPrometida"`
	Pendientes     int        `json:"pendientes"`
	Lineas         int        `json:"lineas"`
}

// OrdenesPorRecibir son las órdenes enviadas o con parte recibida, la que
// se prometió antes primero: lo que el depósito espera que llegue.
func (s *Servicio) OrdenesPorRecibir(ctx context.Context) ([]PorRecibir, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT o.id, o.numero, o.estado::text, s.nombre, b.name, o.fecha_prometida,
		  (SELECT count(*)::int FROM purchase_order_items i WHERE i.purchase_order_id = o.id AND i.cantidad_recibida < i.cantidad),
		  (SELECT count(*)::int FROM purchase_order_items i WHERE i.purchase_order_id = o.id)
		FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN branches b ON b.id = o.branch_id
		WHERE o.estado IN ('enviada', 'parcial')
		ORDER BY o.fecha_prometida NULLS LAST, o.created_at LIMIT 100`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[PorRecibir])
}

// sinCostos borra los importes de una recepción para quien no ve precios.
func sinCostos(r *Recepcion) {
	r.Gastos = ""
	for i := range r.Items {
		it := &r.Items[i]
		it.CostoUnitario = ""
		it.CostoConGastos, it.CostoAnterior, it.CostoResultante = nil, nil, nil
	}
}
