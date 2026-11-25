package stock

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// MetricasDeSucursal son los números de cada sucursal para /admin/sucursales
// (lib/dal/admin/sucursales.ts). La dirección, el teléfono y el horario son
// datos fijos del sitio y los pone Next (lib/sucursales.ts).
type MetricasDeSucursal struct {
	ID                 string  `json:"id"`
	Slug               string  `json:"slug"`
	Nombre             string  `json:"nombre"`
	SortOrder          int32   `json:"sortOrder"`
	Active             bool    `json:"active"`
	VentasHoy          float64 `json:"ventasHoy"`
	PedidosHoy         int     `json:"pedidosHoy"`
	ClientesAtendidos  int     `json:"clientesAtendidos"`
	PedidosAbiertos    int     `json:"pedidosAbiertos"`
	CortesEnCola       int     `json:"cortesEnCola"`
	StockValor         float64 `json:"stockValor"`
	ProductosStockBajo int     `json:"productosStockBajo"`
}

var argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// InicioDelDia es la medianoche argentina de hoy. El TS usaba la del
// servidor (UTC): «las ventas de hoy» arrancaban a las 21 del día anterior.
func InicioDelDia(ahora time.Time) time.Time {
	a := ahora.In(argentina)
	return time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, argentina)
}

// MetricasPorSucursal es sucursalesConMetricas: ventas, pedidos y clientes
// de hoy; pedidos abiertos; cortes en cola; el stock valuado a precio de
// lista general; y cuántas medidas llegaron al mínimo.
func (s *Servicio) MetricasPorSucursal(ctx context.Context, ahora time.Time) ([]MetricasDeSucursal, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT b.id, b.slug, b.name, b.sort_order, b.active,
		  coalesce(v.total, 0)::float8, coalesce(v.pedidos, 0), coalesce(v.clientes, 0),
		  coalesce((SELECT count(*)::int FROM orders o WHERE o.branch_id = b.id AND o.estado NOT IN ('entregado', 'cancelado')), 0),
		  coalesce((SELECT count(*)::int FROM cutting_orders c WHERE c.branch_id = b.id AND c.estado IN ('en-cola', 'en-proceso')), 0),
		  coalesce((SELECT sum(i.qty * pli.price) FROM inventory i
		    JOIN price_list_items pli ON pli.variant_id = i.variant_id
		    JOIN price_lists pl ON pl.id = pli.price_list_id AND pl.is_default
		    WHERE i.branch_id = b.id), 0)::float8,
		  coalesce((SELECT count(*)::int FROM inventory i
		    JOIN product_variants pv ON pv.id = i.variant_id AND pv.active
		    JOIN products p ON p.id = pv.product_id AND p.active
		    WHERE i.branch_id = b.id AND i.min_qty > 0 AND i.qty <= i.min_qty), 0)
		FROM branches b
		LEFT JOIN (
		  SELECT branch_id, sum(total) AS total, count(*)::int AS pedidos,
		    count(DISTINCT coalesce(customer_id::text, contacto_email, id::text))::int AS clientes
		  FROM orders WHERE created_at >= $1 AND estado <> 'cancelado' GROUP BY branch_id
		) v ON v.branch_id = b.id
		ORDER BY b.sort_order`, InicioDelDia(ahora))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[MetricasDeSucursal])
}

// SinSucursal es sinSucursalAsignada: pedidos abiertos y cortes en cola que
// nadie tiene asignados.
func (s *Servicio) SinSucursal(ctx context.Context) (pedidos, cortes int, err error) {
	err = s.pool.QueryRow(ctx, `SELECT
		(SELECT count(*)::int FROM orders WHERE branch_id IS NULL AND estado NOT IN ('entregado', 'cancelado')),
		(SELECT count(*)::int FROM cutting_orders WHERE branch_id IS NULL AND estado IN ('en-cola', 'en-proceso'))`).Scan(&pedidos, &cortes)
	return
}
