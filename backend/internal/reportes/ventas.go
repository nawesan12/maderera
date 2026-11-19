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
	pool *pgxpool.Pool
	// lectura es el pool de los reportes pesados —ventas, cobranzas,
	// reposición, el cierre y los CSV del contador—: pocas conexiones, de
	// solo lectura y con más tiempo por consulta. Un reporte de un año no
	// le saca conexiones al mostrador, y por ahí no puede pasar una
	// escritura. El inicio del panel queda en el principal: se abre a
	// cada rato y no puede esperar detrás de un reporte anual.
	lectura *pgxpool.Pool
	log     *slog.Logger
	ahora   func() time.Time
}

// Nuevo arma el servicio. Sin ConLectura, los reportes van por el mismo pool.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, lectura: pool, log: log, ahora: time.Now}
}

// ConLectura manda los reportes pesados por su propio pool.
func (s *Servicio) ConLectura(p *pgxpool.Pool) *Servicio {
	s.lectura = p
	return s
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
//
// **Un costo es conocido solo si es mayor a 0.** La Bisagra Cierre Suave
// salía con margen del 100 %: una recepción cargada a $0 dejó su costo en
// cero, y cada venta sumaba venta sin costo. Ahora el renglón a $0 cuenta
// como «sin costo», igual que el que no tiene. Va en el SQL y no al congelar
// el costo de la venta, así también corrige lo que ya se vendió.
//
// neto es la venta sin IVA de todos los renglones (el «Vendido sin IVA» de
// Reportes, el del cierre y el de la Ganancia del mes: el mismo número);
// neto_costeado, la de los renglones con costo, que es contra lo que se
// mide el margen. Restar el costo de una parte al neto del todo inflaba el
// margen de cada fila que mezclaba renglones con y sin costo. bruto es la
// suma de los subtotales con IVA, para prorratear el total del pedido.
//
// **Lo devuelto no es vendido** (comité final, M3). La devolución parcial
// no toca order_items: las placas que volvieron contaban como vendidas y
// como disponibles a la vez, la ganancia seguía con su margen, y «Con
// factura» dejaba de coincidir con lo facturado neto de notas de crédito.
// Cada renglón resta lo que sus devoluciones se llevaron (devolucion_items,
// por order_item_id): la cantidad, el importe y el costo de esa cantidad.
// Lo devuelto sin renglón del pedido (un flete, un corte) no se puede
// atribuir y queda vendido.
const (
	costoConocido = `oi.costo_unitario > 0`
	// devueltoDelRenglon se une a order_items oi: lo devuelto de cada
	// renglón (dvr). La tabla es chica y se agrupa una vez.
	devueltoDelRenglon = `LEFT JOIN (SELECT order_item_id, sum(cantidad) AS cantidad, sum(importe) AS importe FROM devolucion_items
		WHERE order_item_id IS NOT NULL GROUP BY order_item_id) dvr ON dvr.order_item_id = oi.id`
	cantidadVendida  = `(oi.cantidad - coalesce(dvr.cantidad, 0))`
	subtotalVendido  = `(oi.subtotal - coalesce(dvr.importe, 0))`
	netoDelRenglon   = subtotalVendido + ` / (1 + coalesce(oi.alicuota_iva, 21) / 100)`
	costoDelRenglon  = cantidadVendida + ` * oi.costo_unitario`
	margenPorRenglon = `sum(` + netoDelRenglon + `),
		sum(` + costoDelRenglon + `) FILTER (WHERE ` + costoConocido + `),
		count(*) FILTER (WHERE oi.costo_unitario IS NULL OR oi.costo_unitario <= 0)::int,
		coalesce(sum(` + netoDelRenglon + `) FILTER (WHERE ` + costoConocido + `), 0)`
	margenPorPedido = `sum(coalesce(margenes.neto, 0)), sum(margenes.costo), coalesce(sum(margenes.sin_costo), 0)::int,
		coalesce(sum(margenes.neto_costeado), 0)`
)

// margenesDe es el neto sin IVA y el costo de cada pedido, para unirlo a
// orders o. Agrupa los renglones **solo de los pedidos que entran en el
// reporte** (los del mismo `where`, que usa el alias o): antes agrupaba
// order_items entero en cada reporte, aunque se pidiera un mes.
//
// Medido con 60.000 pedidos y 180.000 renglones (T8): un mes pasó de 272 a
// 55 ms y un año de 318 a 189; todo el historial queda igual (≈500 ms). Un
// LATERAL por pedido daba 15 ms en un mes pero 494 en un año: con muchos
// pedidos, buscar los renglones de a uno pierde contra agruparlos de una vez.
func margenesDe(where string) string {
	return `LEFT JOIN (
		SELECT oi.order_id,
		       sum(` + netoDelRenglon + `) AS neto,
		       sum(` + subtotalVendido + `) AS bruto,
		       sum(` + costoDelRenglon + `) FILTER (WHERE ` + costoConocido + `) AS costo,
		       count(*) FILTER (WHERE oi.costo_unitario IS NULL OR oi.costo_unitario <= 0)::int AS sin_costo,
		       sum(` + netoDelRenglon + `) FILTER (WHERE ` + costoConocido + `) AS neto_costeado
		FROM order_items oi ` + devueltoDelRenglon + `
		WHERE oi.order_id IN (SELECT o.id FROM orders o WHERE ` + where + `)
		GROUP BY oi.order_id) margenes ON margenes.order_id = o.id`
}

func (s *Servicio) filas(ctx context.Context, sql string, args []any, detalleEnProductos bool) ([]FilaDeReporte, error) {
	rs, err := s.lectura.Query(ctx, sql, args...)
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
		var costeado jsmath.Num
		var sinCosto int
		if err := rs.Scan(&clave, &etiqueta, &f.Detalle, &cantidad, &total, &neto, &costo, &sinCosto, &costeado); err != nil {
			return nil, err
		}
		f.NetoCosteado = costeado.F()
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

// ReporteDeVentas es el corte pedido con los totales del período.
type ReporteDeVentas struct {
	Filas   []FilaDeReporte   `json:"filas"`
	Totales TotalesDelReporte `json:"totales"`
}

// TotalesDelReporte son los del período entero, con los mismos filtros y
// sin el tope de filas de los cortes: la tarjeta «Vendido sin IVA», el
// costo, el margen y el total del CSV y del PDF salen de acá.
//
// Sumaban las filas que se veían: por producto (el corte que se abre
// primero) eran los 50 que más vendieron, y el mismo mes daba otro «Vendido
// sin IVA» por sucursal. Ahora es el mismo número que ResultadoEntre en
// todos los cortes.
//
// Total y Cantidad dependen del corte, como en sus filas: los cortes por
// renglón (producto, rubro, elaboración) suman subtotales y unidades; los
// cortes por pedido, el total del pedido (con envío y descuento) y las
// operaciones. Costo es nil si ningún renglón tiene costo.
type TotalesDelReporte struct {
	Total          float64  `json:"total"`
	Cantidad       float64  `json:"cantidad"`
	NetoVenta      float64  `json:"netoVenta"`
	NetoCosteado   float64  `json:"netoCosteado"`
	Costo          *float64 `json:"costo"`
	LineasSinCosto float64  `json:"lineasSinCosto"`
	// Filas es cuántas tiene el corte entero; la lista trae hasta 50.
	Filas int `json:"filas"`
}

// MargenDelTotal es NetoCosteado − Costo; nil si nada tiene costo.
func (t TotalesDelReporte) MargenDelTotal() *float64 {
	if t.Costo == nil {
		return nil
	}
	m := t.NetoCosteado - *t.Costo
	return &m
}

// porRenglon dice si el corte agrupa renglones (y no pedidos).
func porRenglon(corte string) bool {
	return corte == "producto" || corte == "rubro" || corte == "elaboracion"
}

// totalesDelReporte suma el período sin cortar. filas es cuántas tiene el
// corte (las listas con tope cuentan las suyas aparte).
func (s *Servicio) totalesDelReporte(ctx context.Context, corte, where string, args []any) (TotalesDelReporte, error) {
	var t TotalesDelReporte
	var total, cantidad, neto, costeado jsmath.Num
	var costo *jsmath.Num
	var sinCosto int
	grupo := map[string]string{
		"producto": "coalesce(p.id::text, oi.descripcion)",
		"rubro":    "coalesce(c.id::text, 'sin-categoria')",
	}[corte]
	filas := "0"
	if grupo != "" {
		filas = "(SELECT count(DISTINCT " + grupo + `) FROM order_items oi JOIN orders o ON o.id = oi.order_id `+devueltoDelRenglon+`
			LEFT JOIN product_variants v ON v.id = oi.variant_id LEFT JOIN products p ON p.id = v.product_id
			LEFT JOIN categories c ON c.id = p.category_id WHERE ` + where + ")"
	} else if corte == "cliente" {
		filas = "(SELECT count(DISTINCT coalesce(o.customer_id::text, o.contacto_nombre)) FROM orders o WHERE " + where + ")"
	}
	unidades := "(SELECT coalesce(sum(" + cantidadVendida + "), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id " + devueltoDelRenglon +
		" WHERE " + where + ")"
	montoRenglones := "(SELECT coalesce(sum(" + subtotalVendido + "), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id " + devueltoDelRenglon +
		" WHERE " + where + ")"
	montos, cuantos := "coalesce(sum(o.total), 0)", "count(*)"
	if porRenglon(corte) {
		montos, cuantos = montoRenglones, unidades
	}
	err := s.pool.QueryRow(ctx, `
		SELECT `+montos+`, `+cuantos+`, coalesce(sum(margenes.neto), 0), sum(margenes.costo),
		       coalesce(sum(margenes.sin_costo), 0)::int, coalesce(sum(margenes.neto_costeado), 0), `+filas+`::int
		FROM orders o `+margenesDe(where)+` WHERE `+where, args...).
		Scan(&total, &cantidad, &neto, &costo, &sinCosto, &costeado, &t.Filas)
	if err != nil {
		return t, err
	}
	t.Total, t.Cantidad, t.NetoVenta, t.NetoCosteado, t.LineasSinCosto = total.F(), cantidad.F(), neto.F(), costeado.F(), float64(sinCosto)
	if costo != nil {
		c := costo.F()
		t.Costo = &c
	}
	return t, nil
}

// ReporteDeVentas es reporteDeVentas: el corte pedido (lo raro es por
// producto), sin las canceladas, con los totales del período.
func (s *Servicio) ReporteDeVentas(ctx context.Context, corte string, p Periodo, f Filtros) (ReporteDeVentas, error) {
	corte = LeerCorte(corte)
	where, args := condiciones(p, f)
	filas, err := s.filasDelCorte(ctx, corte, where, args)
	if err != nil {
		return ReporteDeVentas{}, err
	}
	t, err := s.totalesDelReporte(ctx, corte, where, args)
	if err != nil {
		return ReporteDeVentas{}, err
	}
	if t.Filas < len(filas) {
		t.Filas = len(filas)
	}
	return ReporteDeVentas{Filas: filas, Totales: t}, nil
}

func (s *Servicio) filasDelCorte(ctx context.Context, corte, where string, args []any) ([]FilaDeReporte, error) {
	switch corte {
	case "rubro":
		return s.filas(ctx, `
			SELECT coalesce(c.id::text, 'sin-categoria'), coalesce(c.name, 'Sin categoría'), count(DISTINCT p.id)::text,
			       sum(`+cantidadVendida+`), sum(`+subtotalVendido+`), `+margenPorRenglon+`
			FROM order_items oi JOIN orders o ON o.id = oi.order_id `+devueltoDelRenglon+`
			LEFT JOIN product_variants v ON v.id = oi.variant_id
			LEFT JOIN products p ON p.id = v.product_id
			LEFT JOIN categories c ON c.id = p.category_id
			WHERE `+where+` GROUP BY 1, 2 ORDER BY sum(`+subtotalVendido+`) DESC LIMIT 50`, args, true)
	case "elaboracion":
		return s.filas(ctx, `
			SELECT CASE WHEN coalesce(p.recargo_elaboracion_pct, 0) > 0 THEN 'elaborado' ELSE 'bruto' END,
			       CASE WHEN coalesce(p.recargo_elaboracion_pct, 0) > 0 THEN 'Se maquina en planta' ELSE 'Se vende como viene' END,
			       count(DISTINCT p.id)::text, sum(`+cantidadVendida+`), sum(`+subtotalVendido+`), `+margenPorRenglon+`
			FROM order_items oi JOIN orders o ON o.id = oi.order_id `+devueltoDelRenglon+`
			LEFT JOIN product_variants v ON v.id = oi.variant_id
			LEFT JOIN products p ON p.id = v.product_id
			WHERE `+where+` GROUP BY 1, 2 ORDER BY sum(`+subtotalVendido+`) DESC`, args, true)
	case "cliente":
		return s.filas(ctx, `
			SELECT coalesce(cu.id::text, o.contacto_nombre), coalesce(cu.razon_social, cu.nombre, o.contacto_nombre), cu.cuit,
			       count(*), sum(o.total), `+margenPorPedido+`
			FROM orders o `+margenesDe(where)+`
			LEFT JOIN customers cu ON cu.id = o.customer_id
			WHERE `+where+` GROUP BY 1, 2, cu.cuit ORDER BY sum(o.total) DESC LIMIT 50`, args, false)
	case "vendedor":
		return s.filas(ctx, `
			SELECT coalesce(se.id::text, u.id, 'sin-vendedor'), coalesce(se.nombre, u.name, 'Sin vendedor'),
			       CASE WHEN se.id IS NULL AND u.id IS NOT NULL THEN 'Cargó la venta' ELSE NULL END,
			       count(*), sum(o.total), `+margenPorPedido+`
			FROM orders o `+margenesDe(where)+`
			LEFT JOIN sellers se ON se.id = o.seller_id
			LEFT JOIN "user" u ON u.id = o.created_by_user_id
			WHERE `+where+`
			GROUP BY 1, 2, 3 ORDER BY sum(o.total) DESC`, args, false)
	case "sucursal":
		return s.filas(ctx, `
			SELECT coalesce(b.id::text, 'sin-sucursal'), coalesce(b.name, 'Sin sucursal'), NULL::text,
			       count(*), sum(o.total), `+margenPorPedido+`
			FROM orders o `+margenesDe(where)+`
			LEFT JOIN branches b ON b.id = o.branch_id
			WHERE `+where+` GROUP BY 1, 2 ORDER BY sum(o.total) DESC`, args, false)
	case "canal":
		return s.filas(ctx, `
			SELECT o.origen::text, o.origen::text, NULL::text, count(*), sum(o.total), `+margenPorPedido+`
			FROM orders o `+margenesDe(where)+`
			WHERE `+where+` GROUP BY o.origen ORDER BY sum(o.total) DESC`, args, false)
	}
	return s.filas(ctx, `
		SELECT coalesce(p.id::text, oi.descripcion), coalesce(p.name, oi.descripcion), max(v.label),
		       sum(`+cantidadVendida+`), sum(`+subtotalVendido+`), `+margenPorRenglon+`
		FROM order_items oi JOIN orders o ON o.id = oi.order_id `+devueltoDelRenglon+`
		LEFT JOIN product_variants v ON v.id = oi.variant_id
		LEFT JOIN products p ON p.id = v.product_id
		WHERE `+where+` GROUP BY 1, 2 ORDER BY sum(`+subtotalVendido+`) DESC LIMIT 50`, args, false)
}

// VentasPorMes es ventasPorMes: lo vendido mes a mes (meses argentinos) con
// los mismos filtros, con los meses sin ventas en cero.
func (s *Servicio) VentasPorMes(ctx context.Context, p Periodo, f Filtros, meses int) ([]MesDelReporte, error) {
	where, args := condiciones(p, f)
	rs, err := s.lectura.Query(ctx, `
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
