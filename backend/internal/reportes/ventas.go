package reportes

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
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
	// repartos y asientos juntan las llamadas iguales que llegan a la vez
	// (repartoHasta, AsientosDelPeriodo).
	repartos, asientos grupo
	// alCargarReparto, si está, corre dentro de la transacción de cada
	// reparto que se lee de la base (solo las pruebas: cuentan las lecturas
	// y miran el JIT).
	alCargarReparto func(context.Context, pgx.Tx) error
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

// condiciones es enElPeriodo: los hechos de venta del período,
// acotados si se pidió. Los parámetros empiezan en $1.
func condiciones(p Periodo, f Filtros) (string, []any) {
	c := []string{"true"}
	args := []any{}
	agregar := func(sql string, v any) {
		args = append(args, v)
		c = append(c, fmt.Sprintf(sql, len(args)))
	}
	if p.Desde != nil {
		agregar("o.fecha >= $%d", *p.Desde)
	}
	if p.Hasta != nil {
		agregar("o.fecha < $%d", *p.Hasta)
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
//
// **Y se resta en el mes en que se devolvió, no en el de la venta.** Restar
// lo devuelto del pedido cambiaba un mes ya cerrado: la venta del 28/10
// devuelta en parte el 5/11 le bajaba a octubre la ganancia que el contador
// ya tenía, y la nota de crédito iba al libro IVA de noviembre, así que ni
// octubre ni noviembre conciliaban. Por eso los reportes no leen orders y
// order_items directo sino sus hechos: cada venta en su fecha y cada
// devolución en la suya, en negativo (hechosDeVenta y renglonesVendidos).
// Los filtros (sucursal, rubro del cliente, vendedor) siguen siendo los del
// pedido; la fecha es la del hecho (o.fecha). Lo devuelto sin renglón del
// pedido (un flete, un corte) no se puede atribuir y queda vendido.
const (
	// hechosDeVenta tiene las columnas de orders más hecho (el pedido o la
	// devolución), fecha, monto (con IVA, en negativo lo devuelto) y
	// operaciones (1 la venta, 0 la devolución: no es otra operación).
	//
	// La venta es un hecho en la fecha que dice la regla «venta_reconocida»
	// (H162): al entregar o facturar, lo primero (la de arranque), al tomar
	// el pedido, solo al entregar o solo al facturar. Hasta entonces no está
	// en ningún mes. La fecha la ponen los triggers de la 00320
	// (orders.vendido_at, con índice), que nunca mueven una venta de un mes
	// cerrado ni la meten en uno.
	//
	// El pedido cancelado después de contar como venta sigue en su mes y
	// resta en el de la cancelación (cancelado_at), como una devolución, por
	// lo que no se le había devuelto ya: borrarlo de su mes cambiaba un mes
	// cerrado. El que se canceló antes de contar no es ningún hecho. Por eso
	// los reportes no filtran «o.estado <> 'cancelado'»: lo que trae
	// hechosDeVenta ya es lo que cuenta.
	hechosDeVenta = `(SELECT o.*, o.id AS hecho, o.vendido_at AS fecha, o.total AS monto, 1 AS operaciones
		  FROM orders o WHERE o.vendido_at IS NOT NULL AND ` + cuentaComoVenta + `
		UNION ALL
		SELECT o.*, dv.id, dv.created_at, -dv.importe, 0 FROM devoluciones dv JOIN orders o ON o.id = dv.order_id
		  WHERE ` + cuentaComoVenta + `
		UNION ALL
		SELECT o.*, ` + hechoDeLaCancelacion + `, o.cancelado_at,
		  -(o.total - coalesce((SELECT sum(dv.importe) FROM devoluciones dv WHERE dv.order_id = o.id), 0)), 0
		  FROM orders o WHERE ` + canceladaDespues + `)`
	// cuentaComoVenta: el pedido no se canceló, o se canceló después de
	// contar como venta.
	cuentaComoVenta  = `(o.estado <> 'cancelado' OR (o.vendido_at IS NOT NULL AND o.cancelado_at > o.vendido_at))`
	canceladaDespues = `o.estado = 'cancelado' AND o.vendido_at IS NOT NULL AND o.cancelado_at > o.vendido_at`
	// hechoDeLaCancelacion es el id del hecho que resta la cancelación.
	hechoDeLaCancelacion = `md5('cancelacion:' || o.id::text)::uuid`
	// renglonesVendidos son los renglones de cada hecho: los de la venta y,
	// en negativo, lo que se llevó cada devolución, con el costo congelado
	// del renglón que vuelve.
	renglonesVendidos = `(SELECT oi.order_id AS hecho, oi.order_id, oi.variant_id, oi.descripcion, oi.cantidad, oi.subtotal,
		       oi.costo_unitario, oi.alicuota_iva, false AS devuelto FROM order_items oi
		UNION ALL
		SELECT di.devolucion_id, oi.order_id, oi.variant_id, oi.descripcion, -di.cantidad, -di.importe,
		       oi.costo_unitario, oi.alicuota_iva, true
		FROM devolucion_items di JOIN order_items oi ON oi.id = di.order_item_id
		UNION ALL
		SELECT ` + hechoDeLaCancelacion + `, oi.order_id, oi.variant_id, oi.descripcion,
		       -(oi.cantidad - coalesce(d.cantidad, 0)), -(oi.subtotal - coalesce(d.importe, 0)), oi.costo_unitario, oi.alicuota_iva, true
		FROM orders o JOIN order_items oi ON oi.order_id = o.id
		LEFT JOIN LATERAL (SELECT sum(di.cantidad) AS cantidad, sum(di.importe) AS importe FROM devolucion_items di
		                   WHERE di.order_item_id = oi.id) d ON true
		WHERE ` + canceladaDespues + `)`
	costoConocido    = `oi.costo_unitario > 0`
	netoDelRenglon   = `oi.subtotal / (1 + coalesce(oi.alicuota_iva, 21) / 100)`
	costoDelRenglon  = `oi.cantidad * oi.costo_unitario`
	renglonSinCosto  = `NOT oi.devuelto AND (oi.costo_unitario IS NULL OR oi.costo_unitario <= 0)`
	margenPorRenglon = `sum(` + netoDelRenglon + `),
		sum(` + costoDelRenglon + `) FILTER (WHERE ` + costoConocido + `),
		count(*) FILTER (WHERE ` + renglonSinCosto + `)::int,
		coalesce(sum(` + netoDelRenglon + `) FILTER (WHERE ` + costoConocido + `), 0)`
	margenPorPedido = `sum(coalesce(margenes.neto, 0)), sum(margenes.costo), coalesce(sum(margenes.sin_costo), 0)::int,
		coalesce(sum(margenes.neto_costeado), 0)`
	// deLosRenglones es el FROM de los cortes por renglón.
	deLosRenglones = renglonesVendidos + ` oi JOIN ` + hechosDeVenta + ` o ON o.hecho = oi.hecho`
)

// margenesDe es el neto sin IVA y el costo de cada hecho (la venta o la
// devolución), para unirlo a hechosDeVenta o. Agrupa los renglones **solo
// de los hechos que entran en el reporte** (los del mismo `where`, que usa
// el alias o): antes agrupaba order_items entero en cada reporte, aunque se
// pidiera un mes.
//
// Medido con 60.000 pedidos y 180.000 renglones (T8): un mes pasó de 272 a
// 55 ms y un año de 318 a 189; todo el historial queda igual (≈500 ms). Un
// LATERAL por pedido daba 15 ms en un mes pero 494 en un año: con muchos
// pedidos, buscar los renglones de a uno pierde contra agruparlos de una vez.
func margenesDe(where string) string {
	return `LEFT JOIN (
		SELECT oi.hecho,
		       sum(` + netoDelRenglon + `) AS neto,
		       sum(oi.subtotal) AS bruto,
		       sum(` + costoDelRenglon + `) FILTER (WHERE ` + costoConocido + `) AS costo,
		       count(*) FILTER (WHERE ` + renglonSinCosto + `)::int AS sin_costo,
		       sum(` + netoDelRenglon + `) FILTER (WHERE ` + costoConocido + `) AS neto_costeado
		FROM ` + renglonesVendidos + ` oi
		WHERE oi.hecho IN (SELECT o.hecho FROM ` + hechosDeVenta + ` o WHERE ` + where + `)
		GROUP BY oi.hecho) margenes ON margenes.hecho = o.hecho`
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
	// Envios es el flete cobrado del período, con IVA: los cortes por
	// renglón no lo llevan, y es la diferencia con «Vendido con IVA» del
	// inicio (H138).
	Envios float64 `json:"envios"`
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
	var total, cantidad, neto, costeado, envios jsmath.Num
	var costo *jsmath.Num
	var sinCosto int
	grupo := map[string]string{
		"producto": "coalesce(v.id::text, p.id::text, oi.descripcion)",
		"rubro":    "coalesce(c.id::text, 'sin-categoria')",
	}[corte]
	filas := "0"
	if grupo != "" {
		filas = "(SELECT count(DISTINCT " + grupo + `) FROM ` + deLosRenglones + `
			LEFT JOIN product_variants v ON v.id = oi.variant_id LEFT JOIN products p ON p.id = v.product_id
			LEFT JOIN categories c ON c.id = p.category_id WHERE ` + where + ")"
	} else if corte == "cliente" {
		filas = "(SELECT count(DISTINCT coalesce(o.customer_id::text, o.contacto_nombre)) FROM " + hechosDeVenta + " o WHERE " + where + ")"
	}
	unidades := "(SELECT coalesce(sum(oi.cantidad), 0) FROM " + deLosRenglones + " WHERE " + where + ")"
	montoRenglones := "(SELECT coalesce(sum(oi.subtotal), 0) FROM " + deLosRenglones + " WHERE " + where + ")"
	montos, cuantos := "coalesce(sum(o.monto), 0)", "coalesce(sum(o.operaciones), 0)"
	if porRenglon(corte) {
		montos, cuantos = montoRenglones, unidades
	}
	err := s.pool.QueryRow(ctx, `
		SELECT `+montos+`, `+cuantos+`, coalesce(sum(margenes.neto), 0), sum(margenes.costo),
		       coalesce(sum(margenes.sin_costo), 0)::int, coalesce(sum(margenes.neto_costeado), 0), `+filas+`::int,
		       coalesce(sum(o.costo_envio) FILTER (WHERE o.operaciones = 1), 0)
		FROM `+hechosDeVenta+` o `+margenesDe(where)+` WHERE `+where, args...).
		Scan(&total, &cantidad, &neto, &costo, &sinCosto, &costeado, &t.Filas, &envios)
	if err != nil {
		return t, err
	}
	t.Total, t.Cantidad, t.NetoVenta, t.NetoCosteado, t.LineasSinCosto = total.F(), cantidad.F(), neto.F(), costeado.F(), float64(sinCosto)
	t.Envios = envios.F()
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
			       sum(oi.cantidad), sum(oi.subtotal), `+margenPorRenglon+`
			FROM `+deLosRenglones+`
			LEFT JOIN product_variants v ON v.id = oi.variant_id
			LEFT JOIN products p ON p.id = v.product_id
			LEFT JOIN categories c ON c.id = p.category_id
			WHERE `+where+` GROUP BY 1, 2 ORDER BY sum(oi.subtotal) DESC LIMIT 50`, args, true)
	case "elaboracion":
		return s.filas(ctx, `
			SELECT CASE WHEN coalesce(p.recargo_elaboracion_pct, 0) > 0 THEN 'elaborado' ELSE 'bruto' END,
			       CASE WHEN coalesce(p.recargo_elaboracion_pct, 0) > 0 THEN 'Se maquina en planta' ELSE 'Se vende como viene' END,
			       count(DISTINCT p.id)::text, sum(oi.cantidad), sum(oi.subtotal), `+margenPorRenglon+`
			FROM `+deLosRenglones+`
			LEFT JOIN product_variants v ON v.id = oi.variant_id
			LEFT JOIN products p ON p.id = v.product_id
			WHERE `+where+` GROUP BY 1, 2 ORDER BY sum(oi.subtotal) DESC`, args, true)
	case "cliente":
		return s.filas(ctx, `
			SELECT coalesce(cu.id::text, o.contacto_nombre), coalesce(cu.razon_social, cu.nombre, o.contacto_nombre), cu.cuit,
			       sum(o.operaciones), sum(o.monto), `+margenPorPedido+`
			FROM `+hechosDeVenta+` o `+margenesDe(where)+`
			LEFT JOIN customers cu ON cu.id = o.customer_id
			WHERE `+where+` GROUP BY 1, 2, cu.cuit ORDER BY sum(o.monto) DESC LIMIT 50`, args, false)
	case "vendedor":
		return s.filas(ctx, `
			SELECT coalesce(se.id::text, u.id, 'sin-vendedor'), coalesce(se.nombre, u.name, 'Sin vendedor'),
			       CASE WHEN se.id IS NULL AND u.id IS NOT NULL THEN 'Cargó la venta' ELSE NULL END,
			       sum(o.operaciones), sum(o.monto), `+margenPorPedido+`
			FROM `+hechosDeVenta+` o `+margenesDe(where)+`
			LEFT JOIN sellers se ON se.id = o.seller_id
			LEFT JOIN "user" u ON u.id = o.created_by_user_id
			WHERE `+where+`
			GROUP BY 1, 2, 3 ORDER BY sum(o.monto) DESC`, args, false)
	case "sucursal":
		return s.filas(ctx, `
			SELECT coalesce(b.id::text, 'sin-sucursal'), coalesce(b.name, 'Sin sucursal'), NULL::text,
			       sum(o.operaciones), sum(o.monto), `+margenPorPedido+`
			FROM `+hechosDeVenta+` o `+margenesDe(where)+`
			LEFT JOIN branches b ON b.id = o.branch_id
			WHERE `+where+` GROUP BY 1, 2 ORDER BY sum(o.monto) DESC`, args, false)
	case "canal":
		return s.filas(ctx, `
			SELECT o.origen::text, o.origen::text, NULL::text, sum(o.operaciones), sum(o.monto), `+margenPorPedido+`
			FROM `+hechosDeVenta+` o `+margenesDe(where)+`
			WHERE `+where+` GROUP BY o.origen ORDER BY sum(o.monto) DESC`, args, false)
	}
	// Una fila por variante (la medida): juntas por producto y con la medida
	// de una sola, «MDF 3mm · 18» incluía las de 18 mm y «Placa de Yeso RH»
	// las estándar (simulación del mes, H163).
	return s.filas(ctx, `
		SELECT coalesce(v.id::text, p.id::text, oi.descripcion), coalesce(p.name, oi.descripcion), v.label,
		       sum(oi.cantidad), sum(oi.subtotal), `+margenPorRenglon+`
		FROM `+deLosRenglones+`
		LEFT JOIN product_variants v ON v.id = oi.variant_id
		LEFT JOIN products p ON p.id = v.product_id
		WHERE `+where+` GROUP BY 1, 2, 3 ORDER BY sum(oi.subtotal) DESC LIMIT 50`, args, false)
}

// VentasPorMes es ventasPorMes: lo vendido mes a mes (meses argentinos) con
// los mismos filtros, con los meses sin ventas en cero.
func (s *Servicio) VentasPorMes(ctx context.Context, p Periodo, f Filtros, meses int) ([]MesDelReporte, error) {
	where, args := condiciones(p, f)
	rs, err := s.lectura.Query(ctx, `
		SELECT to_char(date_trunc('month', o.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'YYYY-MM'), sum(o.monto)
		FROM `+hechosDeVenta+` o WHERE `+where+` GROUP BY 1`, args...)
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
