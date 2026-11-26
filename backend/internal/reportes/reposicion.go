package reportes

import (
	"context"
	"fmt"
	"math"
	"sort"
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
// cada medida activa, lo vendido en los últimos N días (sin las canceladas
// ni lo devuelto; con la sucursal del pedido) y lo que convendría comprar.
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
	rs, err := s.lectura.Query(ctx, `
		SELECT v.id, p.id, p.name, v.label, v.sku, p.unit, c.name, c.slug, sc.name,
		       coalesce(sum(CASE WHEN b.slug = 'casa-central' THEN i.qty - coalesce(i.reservado, 0) END), 0),
		       coalesce(sum(CASE WHEN b.slug = 'aserradero' THEN i.qty - coalesce(i.reservado, 0) END), 0),
		       coalesce(sum(CASE WHEN b.slug = 'casa-central' THEN i.min_qty END), 0),
		       coalesce(sum(CASE WHEN b.slug = 'aserradero' THEN i.min_qty END), 0),
		       (SELECT sc.supplier_id::text FROM supplier_variant_codes sc WHERE sc.variant_id = v.id ORDER BY sc.created_at DESC LIMIT 1),
		       (SELECT su.nombre FROM supplier_variant_codes sc JOIN suppliers su ON su.id = sc.supplier_id
		        WHERE sc.variant_id = v.id ORDER BY sc.created_at DESC LIMIT 1)
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
	minimos := map[string][2]float64{}
	for rs.Next() {
		var x StockDeVariante
		var central, aserradero, minCentral, minAserradero jsmath.Num
		if err := rs.Scan(&x.VariantID, &x.ProductID, &x.Producto, &x.Medida, &x.Sku, &x.Unidad, &x.Categoria, &x.CategoriaSlug,
			&x.Rubro, &central, &aserradero, &minCentral, &minAserradero, &x.ProveedorID, &x.Proveedor); err != nil {
			rs.Close()
			return ReporteDeReposicion{}, err
		}
		x.DisponibleCentral, x.DisponibleAserradero = central.F(), aserradero.F()
		minimos[x.VariantID] = [2]float64{minCentral.F(), minAserradero.F()}
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
	// Lo devuelto se resta del renglón de la venta, sin importar cuándo se
	// devolvió. Es lo contrario de hechosDeVenta (ventas.go), que lo resta
	// en el mes de la devolución para no tocar un mes ya cerrado: acá se
	// estima la demanda, y una venta de hace 40 días devuelta ayer no tiene
	// que bajar la de este mes. Entra también lo que volvió roto
	// (al_stock = false): el cliente no lo usó. Lo devuelto sin renglón del
	// pedido queda vendido, igual que en ventas. Y la sucursal es la del
	// pedido aunque lo devuelto entre al stock de otra: se mide dónde se
	// pidió, no dónde quedó la placa.
	rs, err = s.lectura.Query(ctx, `
		SELECT oi.variant_id::text,
		       coalesce(sum(greatest(oi.cantidad - coalesce((SELECT sum(di.cantidad) FROM devolucion_items di
		                                                     WHERE di.order_item_id = oi.id), 0), 0)), 0)
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
	return HastaElMinimo(ArmarReposicion(stock, vendido, o.DiasDelPeriodo, o.CoberturaObjetivo, o.Sucursal), minimos, o.Sucursal), nil
}

// HastaElMinimo suma a la sugerencia lo que falta para llegar al mínimo de
// cada sucursal. La sugerencia salía solo de lo vendido: lo que estaba bajo
// el mínimo y no se había vendido en el período decía «Para comprar 0 ·
// Nada por acá» mientras Stock pedía reponerlo y el inicio lo contaba
// (simulación del mes, H062). Lo que falta en una sucursal no lo tapa el
// sobrante de la otra (es otro local), con la regla de Stock: la sucursal
// en cero con la otra con stock no es «reponer» (stock.BajoElMinimo); sin
// stock en ninguna, sí. Va después de ArmarReposicion, que sigue siendo la
// del TS.
func HastaElMinimo(r ReporteDeReposicion, minimos map[string][2]float64, sucursal string) ReporteDeReposicion {
	cambio := false
	for i := range r.Filas {
		f := &r.Filas[i]
		m := minimos[f.VariantID]
		sinNada := f.DisponibleCentral <= 0 && f.DisponibleAserradero <= 0
		falta := func(disponible, minimo float64) float64 {
			if minimo > 0 && disponible <= minimo && (disponible > 0 || sinNada) {
				return math.Ceil(minimo - max(disponible, 0))
			}
			return 0
		}
		var n float64
		switch sucursal {
		case "casa-central":
			n = falta(f.DisponibleCentral, m[0])
		case "aserradero":
			n = falta(f.DisponibleAserradero, m[1])
		default:
			n = float64(falta(f.DisponibleCentral, m[0]) + falta(f.DisponibleAserradero, m[1]))
		}
		if n > f.Sugerido {
			f.Sugerido, cambio = n, true
		}
	}
	if cambio {
		cero := func(p *float64) float64 {
			if p == nil {
				return 0
			}
			return *p
		}
		sort.SliceStable(r.Filas, func(i, j int) bool {
			a, b := r.Filas[i], r.Filas[j]
			if (a.Sugerido > 0) != (b.Sugerido > 0) {
				return a.Sugerido > 0
			}
			if a.Sugerido > 0 && b.Sugerido > 0 {
				return cero(a.Cobertura)-cero(b.Cobertura) < 0
			}
			return b.Vendido-a.Vendido < 0
		})
	}
	return r
}
