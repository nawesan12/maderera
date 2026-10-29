package reportes

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/jsmath"
)

// Servicio son las lecturas de los reportes.
type Servicio struct {
	pool  *pgxpool.Pool
	log   *slog.Logger
	ahora func() time.Time
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, log: log, ahora: time.Now}
}

// Filtros son los del reporte de ventas, además del período: el rubro del
// cliente y la sucursal («todos»/«todas» o vacío no filtran).
type Filtros struct {
	Rubro, Sucursal string
}

// condiciones es enElPeriodo: los pedidos no cancelados del período,
// acotados si se pidió. Los parámetros empiezan en $1.
func condiciones(p Periodo, f Filtros) (string, []any) {
	c := []string{"o.estado <> 'cancelado'"}
	args := []any{}
	agregar := func(sql string, v any) {
		args = append(args, v)
		c = append(c, fmt.Sprintf(sql, len(args)))
	}
	if p.Desde != nil {
		agregar("o.created_at >= $%d", *p.Desde)
	}
	if p.Hasta != nil {
		agregar("o.created_at < $%d", *p.Hasta)
	}
	if f.Rubro != "" && f.Rubro != "todos" {
		agregar("o.customer_id IN (SELECT id FROM customers WHERE rubro = $%d)", f.Rubro)
	}
	if f.Sucursal != "" && f.Sucursal != "todas" {
		// Como texto: un id roto no es un error de la base, es un filtro vacío.
		agregar("o.branch_id::text = $%d", f.Sucursal)
	}
	return strings.Join(c, " AND "), args
}

// Las columnas de margen, por renglón (los cortes por producto, rubro y
// elaboración) o por pedido ya agregado (cliente, vendedor, sucursal y canal:
// sumar renglones sin agregar antes multiplicaría cada pedido).
const (
	margenPorRenglon = `sum(oi.subtotal / (1 + coalesce(oi.alicuota_iva, 21) / 100)),
		sum(oi.cantidad * oi.costo_unitario) FILTER (WHERE oi.costo_unitario IS NOT NULL),
		count(*) FILTER (WHERE oi.costo_unitario IS NULL)::int`
	margenPorPedido = `sum(coalesce(margenes.neto, 0)), sum(margenes.costo), coalesce(sum(margenes.sin_costo), 0)::int`
	margenes        = `LEFT JOIN (
		SELECT oi.order_id,
		       sum(oi.subtotal / (1 + coalesce(oi.alicuota_iva, 21) / 100)) AS neto,
		       sum(oi.cantidad * oi.costo_unitario) FILTER (WHERE oi.costo_unitario IS NOT NULL) AS costo,
		       count(*) FILTER (WHERE oi.costo_unitario IS NULL)::int AS sin_costo
		FROM order_items oi GROUP BY oi.order_id) margenes ON margenes.order_id = o.id`
)

func (s *Servicio) filas(ctx context.Context, sql string, args []any, detalleEnProductos bool) ([]FilaDeReporte, error) {
	rs, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	out := []FilaDeReporte{}
	for rs.Next() {
		var f FilaDeReporte
		var clave, etiqueta *string
		var cantidad, total jsmath.Num
		var neto, costo *jsmath.Num
		var sinCosto int
		if err := rs.Scan(&clave, &etiqueta, &f.Detalle, &cantidad, &total, &neto, &costo, &sinCosto); err != nil {
			return nil, err
		}
		f.Clave, f.Etiqueta = deTexto(clave, "sin-origen"), deTexto(etiqueta, "sin origen")
		f.Cantidad, f.Total, f.LineasSinCosto = cantidad.F(), total.F(), float64(sinCosto)
		if neto != nil {
			f.NetoVenta = neto.F()
		}
		if costo != nil {
			c := costo.F()
			f.Costo = &c
		}
		if detalleEnProductos && f.Detalle != nil {
			// «3 productos»: el TS lo escribía con plural() si el texto no era vacío.
			if *f.Detalle != "" {
				d := Plural(jsmath.Numero(*f.Detalle), "producto", "")
				f.Detalle = &d
			} else {
				f.Detalle = nil
			}
		}
		out = append(out, f)
	}
	return out, rs.Err()
}

func deTexto(p *string, defecto string) string {
	if p == nil {
		return defecto
	}
	return *p
}

// ReporteDeVentas es reporteDeVentas: el corte pedido (lo raro es por
// producto), sin las canceladas.
func (s *Servicio) ReporteDeVentas(ctx context.Context, corte string, p Periodo, f Filtros) ([]FilaDeReporte, error) {
	where, args := condiciones(p, f)
	switch LeerCorte(corte) {
	case "rubro":
		return s.filas(ctx, `
			SELECT coalesce(c.id::text, 'sin-categoria'), coalesce(c.name, 'Sin categoría'), count(DISTINCT p.id)::text,
			       sum(oi.cantidad), sum(oi.subtotal), `+margenPorRenglon+`
			FROM order_items oi JOIN orders o ON o.id = oi.order_id
			LEFT JOIN product_variants v ON v.id = oi.variant_id
			LEFT JOIN products p ON p.id = v.product_id
			LEFT JOIN categories c ON c.id = p.category_id
			WHERE `+where+` GROUP BY 1, 2 ORDER BY sum(oi.subtotal) DESC LIMIT 50`, args, true)
	case "elaboracion":
		return s.filas(ctx, `
			SELECT CASE WHEN coalesce(p.recargo_elaboracion_pct, 0) > 0 THEN 'elaborado' ELSE 'bruto' END,
			       CASE WHEN coalesce(p.recargo_elaboracion_pct, 0) > 0 THEN 'Se maquina en planta' ELSE 'Se vende como viene' END,
			       count(DISTINCT p.id)::text, sum(oi.cantidad), sum(oi.subtotal), `+margenPorRenglon+`
			FROM order_items oi JOIN orders o ON o.id = oi.order_id
			JOIN product_variants v ON v.id = oi.variant_id
			JOIN products p ON p.id = v.product_id
			WHERE `+where+` GROUP BY 1, 2 ORDER BY sum(oi.subtotal) DESC`, args, true)
	case "cliente":
		return s.filas(ctx, `
			SELECT coalesce(cu.id::text, o.contacto_nombre), coalesce(cu.razon_social, cu.nombre, o.contacto_nombre), cu.cuit,
			       count(*), sum(o.total), `+margenPorPedido+`
			FROM orders o `+margenes+`
			LEFT JOIN customers cu ON cu.id = o.customer_id
			WHERE `+where+` GROUP BY 1, 2, cu.cuit ORDER BY sum(o.total) DESC LIMIT 50`, args, false)
	case "vendedor":
		return s.filas(ctx, `
			SELECT coalesce(se.id::text, u.id), coalesce(se.nombre, u.name),
			       CASE WHEN se.id IS NULL THEN 'Cargó la venta' ELSE NULL END,
			       count(*), sum(o.total), `+margenPorPedido+`
			FROM orders o `+margenes+`
			LEFT JOIN sellers se ON se.id = o.seller_id
			LEFT JOIN "user" u ON u.id = o.created_by_user_id
			WHERE `+where+` AND (se.id IS NOT NULL OR u.id IS NOT NULL)
			GROUP BY 1, 2, se.id ORDER BY sum(o.total) DESC`, args, false)
	case "sucursal":
		return s.filas(ctx, `
			SELECT coalesce(b.id::text, 'sin-sucursal'), coalesce(b.name, 'Sin sucursal'), NULL::text,
			       count(*), sum(o.total), `+margenPorPedido+`
			FROM orders o `+margenes+`
			LEFT JOIN branches b ON b.id = o.branch_id
			WHERE `+where+` GROUP BY 1, 2 ORDER BY sum(o.total) DESC`, args, false)
	case "canal":
		return s.filas(ctx, `
			SELECT o.origen::text, o.origen::text, NULL::text, count(*), sum(o.total), `+margenPorPedido+`
			FROM orders o `+margenes+`
			WHERE `+where+` GROUP BY o.origen ORDER BY sum(o.total) DESC`, args, false)
	}
	return s.filas(ctx, `
		SELECT coalesce(p.id::text, oi.descripcion), coalesce(p.name, oi.descripcion), max(v.label),
		       sum(oi.cantidad), sum(oi.subtotal), `+margenPorRenglon+`
		FROM order_items oi JOIN orders o ON o.id = oi.order_id
		LEFT JOIN product_variants v ON v.id = oi.variant_id
		LEFT JOIN products p ON p.id = v.product_id
		WHERE `+where+` GROUP BY 1, 2 ORDER BY sum(oi.subtotal) DESC LIMIT 50`, args, false)
}

// VentasPorMes es ventasPorMes: lo vendido mes a mes (meses argentinos) con
// los mismos filtros, con los meses sin ventas en cero.
func (s *Servicio) VentasPorMes(ctx context.Context, p Periodo, f Filtros, meses int) ([]MesDelReporte, error) {
	where, args := condiciones(p, f)
	rs, err := s.pool.Query(ctx, `
		SELECT to_char(date_trunc('month', o.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'YYYY-MM'), sum(o.total)
		FROM orders o WHERE `+where+` GROUP BY 1`, args...)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	porMes := map[string]float64{}
	for rs.Next() {
		var mes string
		var total jsmath.Num
		if err := rs.Scan(&mes, &total); err != nil {
			return nil, err
		}
		porMes[mes] = total.F()
	}
	if err := rs.Err(); err != nil {
		return nil, err
	}
	return SerieDeMeses(p.Desde, p.Hasta, s.ahora(), meses, porMes), nil
}
