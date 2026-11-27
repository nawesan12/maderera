package reportes

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
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
		// El rubro por su id: el slug se repite entre categorías
		// («accesorios» en tres) y filtrar por él traía los de todas
		// (tercera prueba del mes, H069). El slug sigue andando para los
		// enlaces viejos.
		if plataforma.UUIDValido(o.Rubro) {
			cond = append(cond, fmt.Sprintf("sc.id = $%d::uuid", len(args)))
		} else {
			cond = append(cond, fmt.Sprintf("sc.slug = $%d", len(args)))
		}
	}
	rs, err := s.lectura.Query(ctx, `
		SELECT v.id, p.id, p.name, v.label, v.sku, p.unit, c.name, c.slug, sc.name,
		       coalesce(sum(CASE WHEN b.slug = 'casa-central' THEN i.qty - coalesce(i.reservado, 0) END), 0),
		       coalesce(sum(CASE WHEN b.slug = 'aserradero' THEN i.qty - coalesce(i.reservado, 0) END), 0),
		       coalesce(sum(CASE WHEN b.slug = 'casa-central' THEN i.min_qty END), 0),
		       coalesce(sum(CASE WHEN b.slug = 'aserradero' THEN i.min_qty END), 0),
		       -- El proveedor: al que se le compró por última vez esa medida
		       -- (la última recepción confirmada) o, si nunca se recibió, el
		       -- último con el que se cargó un código (mes simulado, M2S1-034).
		       coalesce((SELECT gr.supplier_id::text FROM goods_receipt_items gi JOIN goods_receipts gr ON gr.id = gi.receipt_id
		                 WHERE gi.variant_id = v.id AND gr.estado = 'confirmada' ORDER BY gr.fecha DESC, gr.created_at DESC LIMIT 1),
		                (SELECT sc.supplier_id::text FROM supplier_variant_codes sc WHERE sc.variant_id = v.id ORDER BY sc.created_at DESC LIMIT 1)),
		       coalesce((SELECT su.nombre FROM goods_receipt_items gi JOIN goods_receipts gr ON gr.id = gi.receipt_id JOIN suppliers su ON su.id = gr.supplier_id
		                 WHERE gi.variant_id = v.id AND gr.estado = 'confirmada' ORDER BY gr.fecha DESC, gr.created_at DESC LIMIT 1),
		                (SELECT su.nombre FROM supplier_variant_codes sc JOIN suppliers su ON su.id = sc.supplier_id
		                 WHERE sc.variant_id = v.id ORDER BY sc.created_at DESC LIMIT 1))
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
	// Lo devuelto se resta del renglón de la venta, sin importar cuándo se
	// devolvió. Es lo contrario de hechosDeVenta (ventas.go), que lo resta
	// en el mes de la devolución para no tocar un mes ya cerrado: acá se
	// estima la demanda, y una venta de hace 40 días devuelta ayer no tiene
	// que bajar la de este mes. Entra también lo que volvió roto
	// (al_stock = false): el cliente no lo usó. Lo devuelto sin renglón del
	// pedido queda vendido, igual que en ventas. Y la sucursal es la del
	// pedido aunque lo devuelto entre al stock de otra: se mide dónde se
	// pidió, no dónde quedó la placa. Por sucursal, para saber qué le falta a
	// cada una; y en pesos, para comparar categorías (las unidades sumaban
	// m² de chapa con tornillos sueltos: M2S3-058).
	rs, err = s.lectura.Query(ctx, `
		SELECT oi.variant_id::text, coalesce(b.slug, ''),
		       coalesce(sum(greatest(oi.cantidad - coalesce((SELECT sum(di.cantidad) FROM devolucion_items di
		                                                     WHERE di.order_item_id = oi.id), 0), 0)), 0),
		       coalesce(sum(oi.subtotal * greatest(1 - coalesce((SELECT sum(di.cantidad) FROM devolucion_items di
		                                                         WHERE di.order_item_id = oi.id), 0) / nullif(oi.cantidad, 0), 0)), 0)::float8
		FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN branches b ON b.id = o.branch_id
		WHERE o.created_at >= $1 AND o.estado <> 'cancelado' AND oi.variant_id = ANY($2::uuid[])
		GROUP BY oi.variant_id, b.slug`, desde, ids)
	if err != nil {
		return ReporteDeReposicion{}, err
	}
	defer rs.Close()
	vendido := map[string]float64{}
	porSucursal := map[string][2]float64{}
	pesos := map[string]float64{}
	for rs.Next() {
		var id, slug string
		var n jsmath.Num
		var plata float64
		if err := rs.Scan(&id, &slug, &n, &plata); err != nil {
			return ReporteDeReposicion{}, err
		}
		x := porSucursal[id]
		switch slug {
		case "casa-central":
			x[0] = float64(x[0] + n.F())
		case "aserradero":
			x[1] = float64(x[1] + n.F())
		}
		porSucursal[id] = x
		if o.Sucursal == "" || o.Sucursal == "todos" || o.Sucursal == slug {
			vendido[id] = float64(vendido[id] + n.F())
			pesos[id] = float64(pesos[id] + plata)
		}
	}
	if err := rs.Err(); err != nil {
		return ReporteDeReposicion{}, err
	}
	r := PorSucursal(ArmarReposicion(stock, vendido, o.DiasDelPeriodo, o.CoberturaObjetivo, o.Sucursal), minimos, porSucursal,
		o.DiasDelPeriodo, o.CoberturaObjetivo, o.Sucursal)
	r.PorCategoria = vendidoEnPesos(r.Filas, pesos)
	return r, nil
}

// vendidoEnPesos es lo vendido por categoría en pesos, de mayor a menor.
func vendidoEnPesos(filas []FilaDeReposicion, pesos map[string]float64) []VendidoPorCategoria {
	orden := []string{}
	suma := map[string]float64{}
	for _, f := range filas {
		if _, ya := suma[f.Categoria]; !ya {
			orden = append(orden, f.Categoria)
		}
		suma[f.Categoria] = float64(suma[f.Categoria] + pesos[f.VariantID])
	}
	out := []VendidoPorCategoria{}
	for _, nombre := range orden {
		if suma[nombre] > 0.005 {
			out = append(out, VendidoPorCategoria{nombre, jsmath.Redondear2(suma[nombre])})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[j].Vendido-out[i].Vendido < 0 })
	return out
}

// PorSucursal decide, medida por medida, qué le falta a cada sucursal y de
// dónde sale (mes simulado, M2S1-029, M2S1-032, M2S1-033 y M3S1-010):
//
//   - Lo que le falta a una sucursal es lo que necesita para cubrir la
//     cobertura objetivo al ritmo de lo que vendió ella, o para quedar **por
//     encima** de su mínimo (justo en el mínimo, Stock vuelve a pedir
//     reponer y el que sigue el reporte compraba dos veces), o para salir del
//     negativo.
//   - Si la otra sucursal tiene de sobra (por encima de lo que necesita
//     ella), primero se trae de ahí; se compra el resto.
//   - Con las dos sucursales, lo que se compra es la suma de lo que compra
//     cada una: el total ya no descuenta el stock del otro local en unas
//     medidas y en otras no.
//
// Lo que se vendió de más (disponible en negativo) va arriba de todo.
func PorSucursal(r ReporteDeReposicion, minimos map[string][2]float64, vendido map[string][2]float64, dias, objetivo float64, sucursal string) ReporteDeReposicion {
	necesita := func(disponible, minimo, vendidas float64) (falta, sobra float64) {
		porVenta := SugerenciaDeCompra(disponible, vendidas, dias, objetivo)
		porMinimo := 0.0
		switch {
		case minimo > 0 && disponible <= minimo:
			porMinimo = math.Floor(float64(minimo-disponible)) + 1
		case disponible < 0:
			porMinimo = math.Ceil(-disponible)
		}
		falta = max(porVenta, porMinimo)
		guardar := math.Ceil(float64(VentaDiaria(vendidas, dias) * objetivo))
		if minimo > 0 {
			guardar = max(guardar, math.Floor(minimo)+1)
		}
		if falta == 0 && disponible > guardar {
			sobra = math.Floor(disponible - guardar)
		}
		return falta, sobra
	}
	for i := range r.Filas {
		f := &r.Filas[i]
		m, v := minimos[f.VariantID], vendido[f.VariantID]
		faltaC, sobraC := necesita(f.DisponibleCentral, m[0], v[0])
		faltaA, sobraA := necesita(f.DisponibleAserradero, m[1], v[1])
		f.TrasladoACentral = min(faltaC, sobraA)
		f.TrasladoAAserradero = min(faltaA, sobraC)
		f.ComprarCentral = faltaC - f.TrasladoACentral
		f.ComprarAserradero = faltaA - f.TrasladoAAserradero
		f.Negativo = f.DisponibleCentral < 0 || f.DisponibleAserradero < 0
		switch sucursal {
		case "casa-central":
			f.Sugerido = f.ComprarCentral
			f.TrasladoAAserradero, f.ComprarAserradero = 0, 0
		case "aserradero":
			f.Sugerido = f.ComprarAserradero
			f.TrasladoACentral, f.ComprarCentral = 0, 0
		default:
			f.Sugerido = float64(f.ComprarCentral + f.ComprarAserradero)
		}
	}
	cero := func(p *float64) float64 {
		if p == nil {
			return 0
		}
		return *p
	}
	hay := func(f FilaDeReposicion) bool {
		return f.Sugerido > 0 || f.TrasladoACentral > 0 || f.TrasladoAAserradero > 0
	}
	sort.SliceStable(r.Filas, func(i, j int) bool {
		a, b := r.Filas[i], r.Filas[j]
		if a.Negativo != b.Negativo {
			return a.Negativo
		}
		if hay(a) != hay(b) {
			return hay(a)
		}
		if hay(a) && hay(b) {
			return cero(a.Cobertura)-cero(b.Cobertura) < 0
		}
		return b.Vendido-a.Vendido < 0
	})
	return r
}
