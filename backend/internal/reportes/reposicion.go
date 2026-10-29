package reportes

import (
	"context"
	"fmt"
	"strings"
	"time"

	"mjbj/internal/jsmath"
)

// OpcionesDeReposicion son las de reporteDeReposicion.
type OpcionesDeReposicion struct {
	DiasDelPeriodo, CoberturaObjetivo float64
	// Categoria y Rubro son slugs; «todos» o vacío no filtran.
	Categoria, Rubro string
	// Sucursal es el slug («casa-central», «aserradero») o «todos».
	Sucursal string
}

// LeerDias es leerDias de la página: 30, 60 o 90; lo demás, 30.
func LeerDias(v float64) float64 {
	if v == 30 || v == 60 || v == 90 {
		return v
	}
	return 30
}

// LeerObjetivo es la cobertura objetivo de la página: entre 7 y 180 días,
// 30 si no vino un número.
func LeerObjetivo(v float64) float64 {
	if v == 0 || v != v {
		v = 30
	}
	return min(max(v, 7), 180)
}

// Reposicion es reporteDeReposicion: el stock disponible por sucursal de
// cada medida activa, lo vendido en los últimos N días (sin las canceladas;
// con la sucursal del pedido) y lo que convendría comprar.
//
// La ventana es «los últimos N días» desde ahora, no días calendario: no
// depende de la zona.
func (s *Servicio) Reposicion(ctx context.Context, o OpcionesDeReposicion) (ReporteDeReposicion, error) {
	cond := []string{"p.active = true", "v.active = true"}
	args := []any{}
	if o.Categoria != "" && o.Categoria != "todos" {
		args = append(args, o.Categoria)
		cond = append(cond, fmt.Sprintf("c.slug = $%d", len(args)))
	}
	if o.Rubro != "" && o.Rubro != "todos" {
		args = append(args, o.Rubro)
		cond = append(cond, fmt.Sprintf("sc.slug = $%d", len(args)))
	}
	rs, err := s.pool.Query(ctx, `
		SELECT v.id, p.id, p.name, v.label, v.sku, p.unit, c.name, c.slug, sc.name,
		       coalesce(sum(CASE WHEN b.slug = 'casa-central' THEN i.qty - coalesce(i.reservado, 0) END), 0),
		       coalesce(sum(CASE WHEN b.slug = 'aserradero' THEN i.qty - coalesce(i.reservado, 0) END), 0)
		FROM product_variants v
		JOIN products p ON p.id = v.product_id
		JOIN categories c ON c.id = p.category_id
		LEFT JOIN subcategories sc ON sc.id = p.subcategory_id
		LEFT JOIN inventory i ON i.variant_id = v.id
		LEFT JOIN branches b ON b.id = i.branch_id
		WHERE `+strings.Join(cond, " AND ")+`
		GROUP BY v.id, p.id, p.name, v.label, v.sku, p.unit, c.name, c.slug, sc.name`, args...)
	if err != nil {
		return ReporteDeReposicion{}, err
	}
	stock := []StockDeVariante{}
	ids := []string{}
	for rs.Next() {
		var x StockDeVariante
		var central, aserradero jsmath.Num
		if err := rs.Scan(&x.VariantID, &x.ProductID, &x.Producto, &x.Medida, &x.Sku, &x.Unidad, &x.Categoria, &x.CategoriaSlug,
			&x.Rubro, &central, &aserradero); err != nil {
			rs.Close()
			return ReporteDeReposicion{}, err
		}
		x.DisponibleCentral, x.DisponibleAserradero = central.F(), aserradero.F()
		stock = append(stock, x)
		ids = append(ids, x.VariantID)
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return ReporteDeReposicion{}, err
	}
	if len(stock) == 0 {
		return ReporteDeReposicion{Filas: []FilaDeReposicion{}, PorCategoria: []VendidoPorCategoria{},
			DiasDelPeriodo: o.DiasDelPeriodo, CoberturaObjetivo: o.CoberturaObjetivo}, nil
	}

	desde := s.ahora().Add(-time.Duration(o.DiasDelPeriodo) * 24 * time.Hour)
	ventaArgs := []any{desde, ids}
	sucursal := ""
	if o.Sucursal != "" && o.Sucursal != "todos" {
		ventaArgs = append(ventaArgs, o.Sucursal)
		sucursal = " AND o.branch_id = (SELECT id FROM branches WHERE slug = $3)"
	}
	rs, err = s.pool.Query(ctx, `
		SELECT oi.variant_id::text, coalesce(sum(oi.cantidad), 0)
		FROM order_items oi JOIN orders o ON o.id = oi.order_id
		WHERE o.created_at >= $1 AND o.estado <> 'cancelado' AND oi.variant_id = ANY($2::uuid[])`+sucursal+`
		GROUP BY oi.variant_id`, ventaArgs...)
	if err != nil {
		return ReporteDeReposicion{}, err
	}
	defer rs.Close()
	vendido := map[string]float64{}
	for rs.Next() {
		var id string
		var n jsmath.Num
		if err := rs.Scan(&id, &n); err != nil {
			return ReporteDeReposicion{}, err
		}
		vendido[id] = n.F()
	}
	if err := rs.Err(); err != nil {
		return ReporteDeReposicion{}, err
	}
	return ArmarReposicion(stock, vendido, o.DiasDelPeriodo, o.CoberturaObjetivo, o.Sucursal), nil
}
