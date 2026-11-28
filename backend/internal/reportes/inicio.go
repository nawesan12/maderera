package reportes

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/autorizacion"
	"mjbj/internal/catalogo"
	"mjbj/internal/jsmath"
	"mjbj/internal/precios"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
	"mjbj/internal/stock"
)

// El inicio del panel (lib/dal/admin/resumen.ts y lib/dal/admin/pendientes.ts):
// los números del negocio para el admin y «qué hay que hacer hoy» para cada
// rol. Solo lectura, aunque lea tablas de otras tandas.

// Metricas es lo que devuelve metricasDelResumen.
type Metricas struct {
	VentasMes              float64  `json:"ventasMes"`
	VariacionVentas        *float64 `json:"variacionVentas"`
	PresupuestosPendientes int      `json:"presupuestosPendientes"`
	PresupuestosRevision   int      `json:"presupuestosRevision"`
	ClientesActivos        int      `json:"clientesActivos"`
	Reponer                int      `json:"reponer"`
	// ReponerPorSucursal es cada sucursal activa, en el orden de branches
	// (hallazgo 35); los dos de abajo son los de antes, leídos de acá.
	ReponerPorSucursal []CantidadDeSucursal `json:"reponerPorSucursal"`
	ReponerCentral     int                  `json:"reponerCentral"`
	ReponerAserradero  int                  `json:"reponerAserradero"`
	PedidosSinEntregar int                  `json:"pedidosSinEntregar"`
	ClientesConPedido  int                  `json:"clientesConPedido"`
}

// consultaDeMetricas son las ventas del período y del anterior, y los
// pedidos sin entregar.
//
// Las ventas se suman solo desde el principio del período anterior (el
// más viejo de los dos): antes la consulta recorría orders entera en cada
// carga del inicio. Sin período («todo») no hay principio y se recorre,
// que es lo que se pidió. least() ignora el NULL: sin período anterior,
// manda el actual. Lo vendido sale de hechosDeVenta, como Reportes: la
// devolución resta en su fecha (comité final, M3), y el «Vendido con IVA»
// del Panel da lo mismo que el reporte al que lleva. Los pendientes son pocos y salen del índice parcial
// orders_abiertos_idx (00168), que tiene justo esas filas.
const consultaDeMetricas = `
		SELECT
		  coalesce(sum(total) FILTER (WHERE ($1::timestamptz IS NULL OR created_at >= $1)
		                                AND ($2::timestamptz IS NULL OR created_at < $2)), 0),
		  coalesce(sum(total) FILTER (WHERE $3::timestamptz IS NOT NULL
		                                AND created_at >= $3 AND created_at < $4), 0),
		  (SELECT count(*)::int FROM orders WHERE estado NOT IN ('entregado', 'cancelado')),
		  (SELECT count(DISTINCT customer_id)::int FROM orders
		    WHERE estado NOT IN ('entregado', 'cancelado') AND customer_id IS NOT NULL)
		FROM (SELECT o.estado, o.fecha AS created_at, o.monto AS total FROM ` + hechosDeVenta + ` o) hechos
		WHERE ($1::timestamptz IS NULL OR created_at >= least($1::timestamptz, $3::timestamptz))`

// MetricasDelResumen es metricasDelResumen: las ventas del período (hora
// argentina) contra el mismo lapso anterior, y los conteos del momento.
func (s *Servicio) MetricasDelResumen(ctx context.Context, p Periodo) (Metricas, error) {
	var m Metricas
	var actual, previo jsmath.Num
	err := s.pool.QueryRow(ctx, consultaDeMetricas,
		p.Desde, p.Hasta, p.AnteriorDesde, p.AnteriorHasta).
		Scan(&actual, &previo, &m.PedidosSinEntregar, &m.ClientesConPedido)
	if err != nil {
		return m, err
	}
	err = s.pool.QueryRow(ctx, `
		SELECT
		  (SELECT (count(*) FILTER (WHERE estado IN ('pendiente', 'revision', 'enviado')))::int FROM quotes),
		  (SELECT (count(*) FILTER (WHERE estado = 'revision'))::int FROM quotes),
		  (SELECT count(*)::int FROM customers WHERE active = true)`).
		Scan(&m.PresupuestosPendientes, &m.PresupuestosRevision, &m.ClientesActivos)
	if err != nil {
		return m, err
	}
	rs, err := s.pool.Query(ctx, `
		SELECT b.slug, b.name, count(i.variant_id) FILTER (WHERE p.active AND v.active AND `+catalogo.ReponerEnFila+`)::int
		FROM branches b
		LEFT JOIN inventory i ON i.branch_id = b.id
		LEFT JOIN product_variants v ON v.id = i.variant_id
		LEFT JOIN products p ON p.id = v.product_id
		WHERE b.active
		GROUP BY b.id, b.slug, b.name, b.sort_order
		ORDER BY b.sort_order, b.name, b.id`)
	if err != nil {
		return m, err
	}
	m.ReponerPorSucursal = []CantidadDeSucursal{}
	var c CantidadDeSucursal
	if _, err := pgx.ForEachRow(rs, []any{&c.Sucursal, &c.Nombre, &c.Cantidad}, func() error {
		m.ReponerPorSucursal = append(m.ReponerPorSucursal, c)
		m.Reponer += c.Cantidad
		switch c.Sucursal {
		case "casa-central":
			m.ReponerCentral = c.Cantidad
		case "aserradero":
			m.ReponerAserradero = c.Cantidad
		}
		return nil
	}); err != nil {
		return m, err
	}
	m.VentasMes = actual.F()
	m.VariacionVentas = Variacion(actual.F(), previo.F())
	return m, nil
}

// CantidadDeSucursal es un conteo de una sucursal activa.
type CantidadDeSucursal struct {
	Sucursal string `json:"sucursal"`
	Nombre   string `json:"nombre"`
	Cantidad int    `json:"cantidad"`
}

// VentaDeSucursal es lo vendido en un mes por una sucursal activa.
type VentaDeSucursal struct {
	Sucursal string  `json:"sucursal"`
	Nombre   string  `json:"nombre"`
	Total    float64 `json:"total"`
}

// VentasDelMes es un mes del gráfico del resumen, por sucursal.
type VentasDelMes struct {
	Mes string `json:"mes"`
	// Sucursales es cada sucursal activa, en el orden de branches; Central y
	// Aserradero son las dos de antes.
	Sucursales []VentaDeSucursal `json:"sucursales"`
	Central    float64           `json:"central"`
	Aserradero float64           `json:"aserradero"`
}

// VentasPorSucursal es ventasPorSucursal del resumen: los últimos seis meses
// (argentinos), con los meses sin ventas en cero.
func (s *Servicio) VentasPorSucursal(ctx context.Context) ([]VentasDelMes, error) {
	ahora := s.ahora()
	type sucursal struct{ slug, nombre string }
	var sucursales []sucursal
	bs, err := s.pool.Query(ctx, `SELECT slug, name FROM branches WHERE active ORDER BY sort_order, name, id`)
	if err != nil {
		return nil, err
	}
	var b sucursal
	if _, err := pgx.ForEachRow(bs, []any{&b.slug, &b.nombre}, func() error {
		sucursales = append(sucursales, b)
		return nil
	}); err != nil {
		return nil, err
	}
	rs, err := s.pool.Query(ctx, `
		SELECT to_char(o.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM'), b.slug, sum(o.monto)
		FROM `+hechosDeVenta+` o LEFT JOIN branches b ON b.id = o.branch_id
		WHERE o.fecha >= $1
		GROUP BY 1, 2`, InicioDeMes(ahora, 5))
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	// por mes y slug
	vendido := map[string]map[string]float64{}
	for rs.Next() {
		var mes string
		var slug *string
		var total jsmath.Num
		if err := rs.Scan(&mes, &slug, &total); err != nil {
			return nil, err
		}
		if slug == nil {
			continue
		}
		if vendido[mes] == nil {
			vendido[mes] = map[string]float64{}
		}
		vendido[mes][*slug] = total.F()
	}
	if err := rs.Err(); err != nil {
		return nil, err
	}
	out := []VentasDelMes{}
	for i := 5; i >= 0; i-- {
		d := InicioDeMes(ahora, i)
		clave := claveDeMes(d)
		m := VentasDelMes{Mes: mesesDelResumen[d.Month()-1], Sucursales: make([]VentaDeSucursal, 0, len(sucursales)),
			Central: vendido[clave]["casa-central"], Aserradero: vendido[clave]["aserradero"]}
		for _, b := range sucursales {
			m.Sucursales = append(m.Sucursales, VentaDeSucursal{Sucursal: b.slug, Nombre: b.nombre, Total: vendido[clave][b.slug]})
		}
		out = append(out, m)
	}
	return out, nil
}

// ParaReponer es una medida en el mínimo o por debajo, con su sucursal
// (catalogo.ReponerEnFila). Qty es lo disponible, con signo.
type ParaReponer struct {
	VariantID string  `json:"variantId"`
	ProductID string  `json:"productId"`
	Producto  string  `json:"producto"`
	Medida    string  `json:"medida"`
	Sucursal  string  `json:"sucursal"`
	Qty       float64 `json:"qty"`
	MinQty    float64 `json:"minQty"`
}

// StockParaReponer es stockParaReponer: lo más urgente primero.
func (s *Servicio) StockParaReponer(ctx context.Context, limite int) ([]ParaReponer, error) {
	rs, err := s.pool.Query(ctx, `
		SELECT v.id, p.id, p.name, v.label, b.name, i.qty - i.reservado, i.min_qty
		FROM inventory i
		JOIN product_variants v ON v.id = i.variant_id
		JOIN products p ON p.id = v.product_id
		JOIN branches b ON b.id = i.branch_id AND b.active
		WHERE p.active AND v.active AND `+catalogo.ReponerEnFila+`
		ORDER BY (i.qty - i.reservado) - i.min_qty, p.name
		LIMIT $1`, limite)
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	out := []ParaReponer{}
	for rs.Next() {
		var x ParaReponer
		var q, m jsmath.Num
		if err := rs.Scan(&x.VariantID, &x.ProductID, &x.Producto, &x.Medida, &x.Sucursal, &q, &m); err != nil {
			return nil, err
		}
		x.Qty, x.MinQty = q.F(), m.F()
		out = append(out, x)
	}
	return out, rs.Err()
}

// PresupuestoReciente y PedidoReciente son las listas del resumen.
type PresupuestoReciente struct {
	ID        string    `json:"id"`
	Numero    string    `json:"numero"`
	Cliente   string    `json:"cliente"`
	Estado    string    `json:"estado"`
	Total     float64   `json:"total"`
	CreatedAt time.Time `json:"createdAt"`
}

// PedidoReciente es un pedido en curso.
type PedidoReciente struct {
	ID          string    `json:"id"`
	Numero      string    `json:"numero"`
	Cliente     string    `json:"cliente"`
	Estado      string    `json:"estado"`
	TipoEntrega string    `json:"tipoEntrega"`
	Total       float64   `json:"total"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Actividad es lo que devuelve actividadReciente.
type Actividad struct {
	Presupuestos []PresupuestoReciente `json:"presupuestos"`
	Pedidos      []PedidoReciente      `json:"pedidos"`
	CortesEnCola int                   `json:"cortesEnCola"`
}

// ActividadReciente es actividadReciente: los últimos presupuestos, los
// pedidos en curso y los cortes en cola o en proceso.
func (s *Servicio) ActividadReciente(ctx context.Context) (Actividad, error) {
	a := Actividad{Presupuestos: []PresupuestoReciente{}, Pedidos: []PedidoReciente{}}
	rs, err := s.pool.Query(ctx, `SELECT id, numero, contacto_nombre, estado::text, total, created_at FROM quotes ORDER BY created_at DESC LIMIT 5`)
	if err != nil {
		return a, err
	}
	for rs.Next() {
		var p PresupuestoReciente
		var t jsmath.Num
		if err := rs.Scan(&p.ID, &p.Numero, &p.Cliente, &p.Estado, &t, &p.CreatedAt); err != nil {
			rs.Close()
			return a, err
		}
		p.Total = t.F()
		a.Presupuestos = append(a.Presupuestos, p)
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return a, err
	}
	rs, err = s.pool.Query(ctx, `
		SELECT id, numero, contacto_nombre, estado::text, tipo_entrega::text, total, created_at FROM orders
		WHERE estado NOT IN ('entregado', 'cancelado') ORDER BY created_at DESC LIMIT 5`)
	if err != nil {
		return a, err
	}
	for rs.Next() {
		var p PedidoReciente
		var t jsmath.Num
		if err := rs.Scan(&p.ID, &p.Numero, &p.Cliente, &p.Estado, &p.TipoEntrega, &t, &p.CreatedAt); err != nil {
			rs.Close()
			return a, err
		}
		p.Total = t.F()
		a.Pedidos = append(a.Pedidos, p)
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return a, err
	}
	err = s.pool.QueryRow(ctx, `SELECT count(*)::int FROM cutting_orders WHERE estado IN ('en-cola', 'en-proceso')`).Scan(&a.CortesEnCola)
	return a, err
}

// Pendiente es Pendiente de lib/dal/admin/pendientes.ts.
type Pendiente struct {
	Clave    string  `json:"clave"`
	Cantidad int     `json:"cantidad"`
	Texto    string  `json:"texto"`
	Detalle  *string `json:"detalle,omitempty"`
	Href     string  `json:"href"`
	Urgente  bool    `json:"urgente,omitempty"`
	// Vencido: lo que ya pasó de fecha o se está perdiendo (un cheque o una
	// factura vencidos, deuda vencida, un pedido atrasado, un presupuesto sin
	// respuesta en plazo). Es lo único que «Para hoy» pinta de rojo: preparar
	// o cortar es el trabajo de cualquier mañana, y una pared roja todos los
	// días deja de mirarse.
	Vencido bool `json:"vencido,omitempty"`
}

func detalle(s string) *string { return &s }

func uno(n int, singular, plural string) string {
	if n == 1 {
		return singular
	}
	return plural
}

// PendientesDelRol es pendientesDelRol: lo que hay que hacer hoy, solo lo
// que el rol puede abrir (el mismo ACCESO que el menú), lo urgente arriba.
//
// Qué es urgente depende de quién mira (mes simulado, H285, H396): la cola
// del taller es el trabajo de la mañana del depósito, y para quien atiende
// es un dato; los presupuestos que esperan respuesta son al revés.
func (s *Servicio) PendientesDelRol(ctx context.Context, rol sqlc.StaffRole) ([]Pendiente, error) {
	ve := func(ruta string) bool { return roles.PuedeEntrar(ruta, &rol) }
	vende := rol == sqlc.StaffRoleVendedor
	var c struct {
		porPreparar, listos, cortes, chequesVencidos, chequesPorVencer int
		comprasPorVencer, solicitudes, resenas                         int
		reponer, seguimientos, presupuestos                            int
		chequesEn48, comprasEn48, bajoCosto, profesionalCaro           int
	}
	ahora := s.ahora()
	// El vencimiento de una factura de compra es un día (medianoche UTC):
	// se compara con el día argentino escrito igual (DiaDeHoy), no con la
	// medianoche argentina, que daba vencida la de hoy (mes simulado, H005).
	hoy := DiaDeHoy(ahora)
	// Las facturas de compra impagas se recorren una sola vez (comité
	// final): antes eran tres subconsultas, cada una con su suma de
	// imputaciones por factura. Sin permiso ($4 falso) el CTE no lee nada.
	// Solo las de proveedores a los que el libro les debe algo, y con los
	// cortes de día de «Debo» (lo vencido sale de ahí, más abajo): una
	// factura cubierta por una nota de crédito figuraba vencida acá mientras
	// «Debo» decía «Nada vencido» (H379).
	err := s.pool.QueryRow(ctx, `
		WITH compras AS (
		  SELECT count(*) FILTER (WHERE fecha_vencimiento >= $10::timestamptz + interval '2 days'
		                            AND fecha_vencimiento < $10::timestamptz + interval '7 days')::int AS por_vencer,
		         count(*) FILTER (WHERE fecha_vencimiento >= $10 AND fecha_vencimiento < $10::timestamptz + interval '2 days')::int AS en48
		  FROM purchase_invoices f
		  WHERE $4 AND fecha_vencimiento IS NOT NULL AND f.anulada_at IS NULL AND f.tipo::text NOT LIKE 'nota_credito%'
		    AND `+saldoDeCompra+` > 0.01
		    AND (SELECT coalesce(sum(m.monto), 0) FROM supplier_movements m WHERE m.supplier_id = f.supplier_id) > 0.005)
		SELECT
		  CASE WHEN $1 THEN (SELECT count(*) FILTER (WHERE estado IN ('pendiente', 'preparando'))::int FROM orders) ELSE 0 END,
		  CASE WHEN $1 THEN (SELECT count(*) FILTER (WHERE estado = 'listo')::int FROM orders) ELSE 0 END,
		  CASE WHEN $2 THEN (SELECT count(*)::int FROM cutting_orders WHERE estado = 'en-cola') ELSE 0 END,
		  CASE WHEN $3 THEN (SELECT count(*) FILTER (WHERE fecha_pago < now())::int FROM cheques
		                     WHERE estado IN ('cartera', 'entregado', 'depositado')) ELSE 0 END,
		  CASE WHEN $3 THEN (SELECT count(*) FILTER (WHERE fecha_pago >= now() + interval '48 hours' AND fecha_pago < now() + interval '7 days')::int FROM cheques
		                     WHERE estado IN ('cartera', 'entregado', 'depositado')) ELSE 0 END,
		  (SELECT por_vencer FROM compras),
		  CASE WHEN $5 THEN (SELECT count(*)::int FROM professional_applications WHERE estado = 'pendiente') ELSE 0 END,
		  CASE WHEN $6 THEN (SELECT count(*)::int FROM product_reviews WHERE estado = 'pendiente') ELSE 0 END,
		  CASE WHEN $7 THEN (SELECT count(*)::int FROM product_variants v JOIN products p ON p.id = v.product_id
		                     WHERE p.active AND v.active AND `+stock.CondicionReponer+`) ELSE 0 END,
		  CASE WHEN $8 THEN (SELECT count(*)::int FROM customer_follow_ups
		                     WHERE etapa <> 'cerrado' AND proxima_accion_at IS NOT NULL AND proxima_accion_at <= $11) ELSE 0 END,
		  CASE WHEN $9 THEN (SELECT count(*)::int FROM quotes WHERE estado = 'enviado'
		                     AND valido_hasta >= now() AND valido_hasta < now() + interval '3 days') ELSE 0 END,
		  CASE WHEN $3 THEN (SELECT count(*) FILTER (WHERE fecha_pago >= now() AND fecha_pago < now() + interval '48 hours')::int FROM cheques
		                     WHERE estado IN ('cartera', 'entregado', 'depositado')) ELSE 0 END,
		  (SELECT en48 FROM compras),
		  CASE WHEN $12 THEN (SELECT count(*)::int FROM product_variants v JOIN products p ON p.id = v.product_id
		                      WHERE p.active AND v.active AND `+precios.BajoCostoDe(`coalesce((SELECT pli.price FROM price_list_items pli
		                        JOIN price_lists pl ON pl.id = pli.price_list_id AND pl.is_default WHERE pli.variant_id = v.id), 0)`)+`) ELSE 0 END,
		  CASE WHEN $12 THEN (SELECT count(*)::int FROM product_variants v JOIN products p ON p.id = v.product_id
		                      WHERE p.active AND v.active AND EXISTS (
		                        SELECT 1 FROM price_list_items g JOIN price_lists gl ON gl.id = g.price_list_id AND gl.is_default
		                        JOIN price_list_items pr ON pr.variant_id = g.variant_id
		                        JOIN price_lists pl ON pl.id = pr.price_list_id AND pl.slug = 'profesional'
		                        WHERE g.variant_id = v.id AND g.price > 0 AND pr.price > g.price)) ELSE 0 END`,
		ve("/admin/pedidos"), ve("/admin/cortes"), ve("/admin/cheques"), ve("/admin/compras/facturas"),
		ve("/admin/profesionales"), ve("/admin/contenido"), ve("/admin/stock"), ve("/admin/clientes"), ve("/admin/presupuestos"), hoy, ahora,
		ve("/admin/precios")).
		Scan(&c.porPreparar, &c.listos, &c.cortes, &c.chequesVencidos, &c.chequesPorVencer, &c.comprasPorVencer,
			&c.solicitudes, &c.resenas, &c.reponer, &c.seguimientos, &c.presupuestos, &c.chequesEn48, &c.comprasEn48, &c.bajoCosto, &c.profesionalCaro)
	if err != nil {
		return nil, err
	}
	o, err := s.otrosPendientes(ctx, ve, ahora)
	if err != nil {
		return nil, err
	}
	// Lo vencido con los proveedores es el mismo número de «Debo».
	comprasVencidas := 0
	if ve("/admin/compras/facturas") {
		d, err := s.Debo(ctx, ahora)
		if err != nil {
			return nil, err
		}
		comprasVencidas = d.FacturasVencidas
	}
	sinPIN := false
	if rol == sqlc.StaffRoleAdmin {
		hay, err := autorizacion.HayAdminConPIN(ctx, s.pool)
		if err != nil {
			return nil, err
		}
		sinPIN = !hay
	}
	f := []Pendiente{}
	agregar := func(n int, p Pendiente) {
		if n > 0 {
			p.Cantidad = n
			f = append(f, p)
		}
	}
	// Sin PIN, todo lo que pide autorización en el mostrador queda trabado:
	// es lo primero de la mañana (H067). La pantalla lo dibuja con su botón.
	if sinPIN {
		agregar(1, Pendiente{Clave: "pin", Texto: "Cargar tu PIN de autorización", Href: "/admin", Urgente: true})
	}
	agregar(c.seguimientos, Pendiente{Clave: "seguimiento", Texto: uno(c.seguimientos, "cliente para llamar hoy", "clientes para llamar hoy"),
		Detalle: detalle("Seguimientos con la fecha cumplida"), Href: "/admin/clientes/seguimiento", Urgente: true})
	// Las que siguen abiertas para más adelante: la cobranza de quien vende
	// no se veía sin entrar a Seguimiento (mes simulado, M2S4-026).
	agregar(o.gestiones, Pendiente{Clave: "gestiones", Texto: uno(o.gestiones, "gestión abierta con clientes", "gestiones abiertas con clientes"),
		Href: "/admin/clientes/seguimiento"})
	agregar(c.porPreparar, Pendiente{Clave: "preparar", Texto: uno(c.porPreparar, "pedido por preparar", "pedidos por preparar"),
		Detalle: detalle("Todavía no salieron a armarse"), Href: "/admin/pedidos?estado=por-preparar", Urgente: true})
	// Solo los listos: los que están en camino ya salieron, y Pedidos, a
	// donde lleva, los muestra en otra columna (H102, H323). Para el
	// depósito es el trabajo del día: entregar y despachar (H396).
	agregar(c.listos, Pendiente{Clave: "entregar", Texto: uno(c.listos, "pedido listo sin entregar", "pedidos listos sin entregar"),
		Detalle: detalle("Armados y esperando que los retiren o salgan"), Href: "/admin/pedidos?estado=listo", Urgente: rol == sqlc.StaffRoleDeposito})
	agregar(c.cortes, Pendiente{Clave: "cortes", Texto: uno(c.cortes, "corte en la cola", "cortes en la cola"),
		Detalle: detalle("Esperando la seccionadora"), Href: "/admin/cortes", Urgente: !vende})
	agregar(o.cortesHoy, Pendiente{Clave: "cortes-hoy", Texto: uno(o.cortesHoy, "corte para retirar hoy", "cortes para retirar hoy"),
		Href: "/admin/cortes", Urgente: true})
	// Quien vende no entra a Cheques: el rechazo se reclama desde el
	// seguimiento del cliente (mes simulado, M2S4-026).
	hrefRechazados := "/admin/cheques"
	if !ve("/admin/cheques") {
		hrefRechazados = "/admin/clientes/seguimiento"
	}
	agregar(o.chequesRechazados, Pendiente{Clave: "cheques-rechazados", Texto: uno(o.chequesRechazados, "cheque rechazado", "cheques rechazados"),
		Href: hrefRechazados, Urgente: true, Vencido: true})
	agregar(c.chequesVencidos, Pendiente{Clave: "cheques-vencidos", Texto: uno(c.chequesVencidos, "cheque pasado de fecha", "cheques pasados de fecha"),
		Detalle: detalle("Venció y sigue en cartera"), Href: "/admin/cheques", Urgente: true, Vencido: true})
	// Lo que vence en las próximas 48 horas es de hoy: un cheque que vence
	// mañana se deposita o se cubre hoy, no «esta semana».
	agregar(c.chequesEn48, Pendiente{Clave: "cheques-48h", Texto: uno(c.chequesEn48, "cheque vence en 48 horas", "cheques vencen en 48 horas"),
		Detalle: detalle("Los recibidos hay que depositarlos; los entregados, cubrirlos"), Href: "/admin/cheques", Urgente: true})
	agregar(c.chequesPorVencer, Pendiente{Clave: "cheques", Texto: uno(c.chequesPorVencer, "cheque vence esta semana", "cheques vencen esta semana"),
		Detalle: detalle("Los recibidos hay que depositarlos; los entregados, cubrirlos"), Href: "/admin/cheques"})
	// Lo que hay que aceptar o acreditar (H379): la transferencia que el
	// cliente informó y el cheque que avisó que manda.
	agregar(o.transferencias, Pendiente{Clave: "transferencias", Texto: uno(o.transferencias, "transferencia a verificar", "transferencias a verificar"),
		Href: "/admin/pagos", Urgente: true})
	agregar(o.chequesInformados, Pendiente{Clave: "cheques-por-recibir", Texto: uno(o.chequesInformados, "cheque por recibir", "cheques por recibir"),
		Href: "/admin/cheques", Urgente: true})
	agregar(comprasVencidas, Pendiente{Clave: "compras-vencidas", Texto: uno(comprasVencidas, "factura de compra vencida", "facturas de compra vencidas"),
		Detalle: detalle("Pasó el vencimiento y sigue sin pagarse del todo"), Href: "/admin/compras/facturas", Urgente: true, Vencido: true})
	agregar(c.comprasEn48, Pendiente{Clave: "compras-48h", Texto: uno(c.comprasEn48, "factura de compra vence en 48 horas", "facturas de compra vencen en 48 horas"),
		Href: "/admin/compras/facturas", Urgente: true})
	agregar(c.comprasPorVencer, Pendiente{Clave: "compras", Texto: uno(c.comprasPorVencer, "factura de compra vence esta semana", "facturas de compra vencen esta semana"),
		Href: "/admin/compras/facturas"})
	// Las órdenes de compra (H067, H201): la atrasada es para llamar al
	// proveedor; la de hoy o mañana, para tener lugar y gente.
	agregar(o.ordenesAtrasadas, Pendiente{Clave: "ordenes-atrasadas", Texto: uno(o.ordenesAtrasadas, "orden de compra atrasada", "órdenes de compra atrasadas"),
		Href: "/admin/compras/ordenes", Urgente: true, Vencido: true})
	agregar(o.ordenesPorLlegar, Pendiente{Clave: "ordenes-por-llegar", Texto: uno(o.ordenesPorLlegar, "orden de compra llega hoy o mañana", "órdenes de compra llegan hoy o mañana"),
		Href: "/admin/compras/ordenes", Urgente: true})
	agregar(o.recepcionesSinFactura, Pendiente{Clave: "recepciones-sin-factura", Texto: uno(o.recepcionesSinFactura,
		"recepción sin factura de compra", "recepciones sin factura de compra"), Href: "/admin/recepciones?estado=sin-factura"})
	agregar(o.presupuestosEnviados, Pendiente{Clave: "presupuestos-enviados", Texto: uno(o.presupuestosEnviados,
		"presupuesto enviado sin respuesta", "presupuestos enviados sin respuesta"), Href: "/admin/presupuestos?estado=enviado", Urgente: vende})
	agregar(o.aceptadosSinPedido, Pendiente{Clave: "presupuestos-aceptados", Texto: uno(o.aceptadosSinPedido,
		"presupuesto aceptado sin pedido", "presupuestos aceptados sin pedido"), Href: "/admin/presupuestos?estado=sin-pedido", Urgente: true})
	agregar(c.presupuestos, Pendiente{Clave: "presupuestos", Texto: uno(c.presupuestos, "presupuesto enviado vence en 3 días", "presupuestos enviados vencen en 3 días"),
		Detalle: detalle("Un llamado antes de que venza suele cerrar la venta"), Href: "/admin/presupuestos"})
	agregar(c.solicitudes, Pendiente{Clave: "profesionales", Texto: uno(c.solicitudes, "profesional esperando respuesta", "profesionales esperando respuesta"),
		Detalle: detalle("Pidieron la cuenta con precio de gremio"), Href: "/admin/profesionales"})
	// Medidas, como Stock, y con la misma regla (catalogo.MedidaParaReponer):
	// contaba filas por sucursal con el físico y las llamaba «productos», y
	// el atajo abría Stock sin filtrar (mes simulado, H004, H102, H358).
	agregar(c.reponer, Pendiente{Clave: "reponer", Texto: uno(c.reponer, "medida para reponer", "medidas para reponer"),
		Detalle: detalle("Llegó al mínimo o se vendió de más"), Href: "/admin/stock?estado=reponer"})
	// El stock en negativo (se vendió lo que no había): aparte y urgente,
	// porque el número de Stock está mal hasta que se cuente o se reciba
	// (mes simulado, M2S4-001). Lleva a la reposición, donde va arriba.
	if ve("/admin/stock") {
		var negativos int
		if err := s.pool.QueryRow(ctx, `SELECT count(DISTINCT i.variant_id)::int FROM inventory i
			JOIN product_variants v ON v.id = i.variant_id JOIN products p ON p.id = v.product_id
			WHERE p.active AND v.active AND i.qty - coalesce(i.reservado, 0) < 0`).Scan(&negativos); err != nil {
			return nil, err
		}
		agregar(negativos, Pendiente{Clave: "stock-negativo", Texto: uno(negativos, "medida con stock en negativo", "medidas con stock en negativo"),
			Href: "/admin/reportes/reposicion", Urgente: true, Vencido: true})
	}
	// El precio de lista bajo el costo: cada venta pierde plata (H139).
	agregar(c.bajoCosto, Pendiente{Clave: "bajo-costo", Texto: uno(c.bajoCosto, "medida con el precio bajo el costo", "medidas con el precio bajo el costo"),
		Href: "/admin/precios?estado=bajo-costo", Urgente: true})
	// El profesional pagando más que un consumidor final (mes simulado: los
	// tirantes de pino a $25.650 en la profesional y $12.345 en la general).
	// No se corrige solo: cuál de los dos precios es el bueno lo sabe la dueña.
	agregar(c.profesionalCaro, Pendiente{Clave: "profesional-caro", Texto: uno(c.profesionalCaro,
		"medida más cara para el profesional", "medidas más caras para el profesional"),
		Href: "/admin/precios?estado=profesional-caro", Urgente: true})
	agregar(c.resenas, Pendiente{Clave: "resenas", Texto: uno(c.resenas, "reseña sin moderar", "reseñas sin moderar"),
		Detalle: detalle("No se publican hasta que alguien las mire"), Href: "/admin/contenido"})
	agregar(o.whatsapp, Pendiente{Clave: "whatsapp", Texto: uno(o.whatsapp, "conversación de WhatsApp sin contestar", "conversaciones de WhatsApp sin contestar"),
		Href: "/admin/whatsapp?filtro=sin-leer", Urgente: true})
	agregar(o.whatsappSinAsignar, Pendiente{Clave: "whatsapp-sin-asignar", Texto: uno(o.whatsappSinAsignar,
		"conversación derivada sin asignar", "conversaciones derivadas sin asignar"), Href: "/admin/whatsapp?filtro=derivadas", Urgente: true})
	// El pedido de presupuesto que entró (de la web, del bot, del teléfono) y
	// todavía está en plazo: es lo primero de quien vende, y ni «Para hoy» ni
	// la campana lo decían hasta que se vencía (mes simulado, M2S1-191).
	agregar(o.porResponder, Pendiente{Clave: "presupuestos-por-responder", Texto: uno(o.porResponder,
		"presupuesto por responder", "presupuestos por responder"), Href: "/admin/presupuestos?estado=abiertos", Urgente: vende})
	agregar(o.presupuestosVencidos, Pendiente{Clave: "presupuestos-sin-responder", Texto: uno(o.presupuestosVencidos,
		"presupuesto pasado del plazo de respuesta", "presupuestos pasados del plazo de respuesta"),
		Href: "/admin/presupuestos?estado=abiertos", Urgente: true, Vencido: true})
	agregar(o.pedidosAtrasados, Pendiente{Clave: "pedidos-atrasados", Texto: uno(o.pedidosAtrasados, "pedido atrasado", "pedidos atrasados"),
		Href: "/admin/pedidos", Urgente: true, Vencido: true})
	agregar(o.cortesSinRetirar, Pendiente{Clave: "cortes-sin-retirar", Texto: uno(o.cortesSinRetirar, "corte terminado sin retirar", "cortes terminados sin retirar"),
		Href: "/admin/cortes"})
	agregar(o.clientesConVencido, Pendiente{Clave: "deuda-vencida", Texto: uno(o.clientesConVencido, "cliente con deuda vencida", "clientes con deuda vencida"),
		Href: "/admin/clientes", Urgente: true, Vencido: true})
	// Sin CAE: no es urgente (no depende de la maderera), pero tiene que
	// verse sin entrar a Facturación (H141).
	agregar(o.sinCAE, Pendiente{Clave: "sin-cae", Texto: uno(o.sinCAE, "comprobante sin CAE", "comprobantes sin CAE"), Href: "/admin/facturacion"})
	// La carga del catálogo es de quien administra: a quien vende, «40
	// medidas sin foto» le tapaba lo suyo (M2S4-026).
	if vende {
		o.sinPrecio, o.sinFoto = 0, 0
	}
	agregar(o.sinPrecio, Pendiente{Clave: "catalogo-precio", Texto: uno(o.sinPrecio, "medida sin precio", "medidas sin precio"), Href: "/admin/precios"})
	agregar(o.sinFoto, Pendiente{Clave: "catalogo-foto", Texto: uno(o.sinFoto, "medida sin foto", "medidas sin foto"), Href: "/admin/productos"})
	// Sin nada para vender: lo vendido de más no cuenta como stock (H218).
	agregar(o.sinStock, Pendiente{Clave: "catalogo-stock", Texto: uno(o.sinStock, "medida sin stock", "medidas sin stock"), Href: "/admin/stock?estado=sin-stock"})
	OrdenarPendientes(f)
	return f, nil
}

// OrdenarPendientes: lo urgente arriba; adentro de cada grupo, lo vencido
// primero y después la cantidad. La carga del catálogo va siempre al final:
// cuarenta medidas sin foto no pueden encabezar la lista de la mañana por
// ser muchas (H298).
func OrdenarPendientes(f []Pendiente) {
	catalogo := func(p Pendiente) bool { return strings.HasPrefix(p.Clave, "catalogo-") }
	sort.SliceStable(f, func(i, j int) bool {
		if f[i].Urgente != f[j].Urgente {
			return f[i].Urgente
		}
		if catalogo(f[i]) != catalogo(f[j]) {
			return !catalogo(f[i])
		}
		if f[i].Vencido != f[j].Vencido {
			return f[i].Vencido
		}
		return f[j].Cantidad-f[i].Cantidad < 0
	})
}

// otros son los pendientes que se sumaron en la revisión del 17/11: los que
// esperan una respuesta (WhatsApp, presupuestos), lo que se prometió y no
// salió (pedidos, cortes), la deuda vencida y, mientras la tienda está
// apagada, cuánto falta para cargar el catálogo.
type otros struct {
	whatsapp, presupuestosVencidos, pedidosAtrasados, cortesSinRetirar, clientesConVencido int
	sinPrecio, sinFoto, sinStock                                                           int
	// Los del mes simulado (26/11).
	cortesHoy, chequesRechazados, chequesInformados, transferencias   int
	ordenesAtrasadas, ordenesPorLlegar, recepcionesSinFactura, sinCAE int
	presupuestosEnviados, aceptadosSinPedido, whatsappSinAsignar      int
	gestiones, porResponder                                           int
}

// otrosPendientes los cuenta, solo para lo que el rol puede abrir.
//
//   - Presupuesto sin responder: pendiente o en revisión con el plazo de
//     respuesta (responde_hasta, el compromiso de lib/plazos.ts) cumplido.
//   - Pedido atrasado: sin entregar, y el presupuesto del que salió decía
//     el día en que se comprometió entregarlo (entregar_el, o si no el
//     necesita_para de su presupuesto) y ese día pasó.
//     Un pedido no guarda una fecha comprometida propia: el que no salió de
//     un presupuesto con fecha no puede estar atrasado. Se comparan días en
//     hora argentina: `entregar_el` es date, y pasado a timestamptz en la
//     sesión de Postgres (UTC) un pedido para hoy figuraba atrasado.
//   - Corte sin retirar: terminado (retirado es otro estado).
//   - WhatsApp sin contestar: abierta con mensajes sin leer, el mismo
//     criterio que el número del menú.
//   - El catálogo: medidas activas de productos activos sin precio en la
//     lista general, sin ninguna foto del producto o sin unidades en ninguna
//     sucursal. Solo con la tienda apagada (tienda_activa ≠ «si»): es la carga
//     que la clienta tiene que terminar antes de vender en línea; con la
//     tienda andando, una medida sin stock es la reposición.
func (s *Servicio) otrosPendientes(ctx context.Context, ve func(string) bool, ahora time.Time) (otros, error) {
	var o otros
	var tienda string
	hoy := InicioDelDia(ahora)
	err := s.pool.QueryRow(ctx, `
		SELECT
		  CASE WHEN $1 THEN (SELECT count(*)::int FROM whatsapp_conversaciones WHERE estado = 'abierta' AND no_leidos > 0) ELSE 0 END,
		  CASE WHEN $2 THEN (SELECT count(*)::int FROM quotes WHERE estado IN ('pendiente', 'revision') AND responde_hasta < $5) ELSE 0 END,
		  CASE WHEN $3 THEN (SELECT count(*)::int FROM orders o LEFT JOIN quotes q ON q.id = o.quote_id
		                     WHERE o.estado NOT IN ('entregado', 'cancelado')
		                       AND coalesce(o.entregar_el, (q.necesita_para AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)
		                           < ($6 AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) ELSE 0 END,
		  CASE WHEN $4 THEN (SELECT count(*)::int FROM cutting_orders WHERE estado = 'terminado') ELSE 0 END,
		  coalesce((SELECT valor FROM site_settings WHERE clave = 'tienda_activa'), 'si')`,
		ve("/admin/whatsapp"), ve("/admin/presupuestos"), ve("/admin/pedidos"), ve("/admin/cortes"), ahora, hoy).
		Scan(&o.whatsapp, &o.presupuestosVencidos, &o.pedidosAtrasados, &o.cortesSinRetirar, &tienda)
	if err != nil {
		return o, err
	}
	// Los del mes simulado (26/11):
	//   - Corte para retirar hoy: el día que se le dijo al cliente, sin
	//     retirar ni cancelar.
	//   - Cheque rechazado: recibido o propio, rechazado en los últimos siete
	//     días (el que rebotó a la mañana no figuraba en ningún lado).
	//   - Cheque por recibir: el cliente lo informó y nadie lo tiene todavía.
	//   - Transferencia a verificar: el cobro que el cliente informó y espera
	//     que alguien lo mire contra el extracto (el «A verificar» de Cobros).
	//   - Orden de compra enviada o con entrega parcial: atrasada si la fecha
	//     prometida pasó; por llegar si es hoy o mañana (días argentinos).
	//   - Recepción confirmada sin factura de compra, como el Cierre.
	//   - Comprobante emitido sin CAE, como el Cierre.
	//   - Presupuesto enviado y vigente, y aceptado sin pedido.
	//   - WhatsApp derivado por el bot a una persona y sin nadie asignado.
	err = s.pool.QueryRow(ctx, `
		SELECT
		  CASE WHEN $1 THEN (SELECT count(*)::int FROM cutting_orders WHERE estado NOT IN ('retirado', 'cancelado')
		                     AND retira_el = ($9 AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) ELSE 0 END,
		  CASE WHEN $2 OR $11 THEN (SELECT count(DISTINCT e.cheque_id)::int FROM cheque_estados e JOIN cheques c ON c.id = e.cheque_id
		                     WHERE e.hacia = 'rechazado' AND e.desde <> 'informado' AND c.estado = 'rechazado'
		                       AND ($2 OR c.sentido = 'recibido') AND e.at >= $9::timestamptz - interval '6 days') ELSE 0 END,
		  CASE WHEN $2 THEN (SELECT count(*)::int FROM cheques WHERE estado = 'informado') ELSE 0 END,
		  CASE WHEN $3 THEN (SELECT count(*)::int FROM payments WHERE estado = 'en_revision') ELSE 0 END,
		  CASE WHEN $4 THEN (SELECT count(*)::int FROM purchase_orders WHERE estado IN ('enviada', 'parcial') AND fecha_prometida < $9) ELSE 0 END,
		  CASE WHEN $4 THEN (SELECT count(*)::int FROM purchase_orders WHERE estado IN ('enviada', 'parcial')
		                     AND fecha_prometida >= $9 AND fecha_prometida < $10) ELSE 0 END,
		  CASE WHEN $5 THEN (SELECT count(*)::int FROM goods_receipts g WHERE g.estado = 'confirmada'
		                     AND `+RecepcionSinFactura+`) ELSE 0 END,
		  CASE WHEN $6 THEN (SELECT count(*)::int FROM invoices WHERE estado IN ('emitida', 'rechazada')) ELSE 0 END,
		  CASE WHEN $7 THEN (SELECT count(*)::int FROM quotes WHERE estado = 'enviado' AND (valido_hasta IS NULL OR valido_hasta >= now())) ELSE 0 END,
		  CASE WHEN $7 THEN (SELECT count(*)::int FROM quotes q WHERE q.estado = 'aceptado'
		                     AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.quote_id = q.id AND o.estado <> 'cancelado')) ELSE 0 END,
		  CASE WHEN $8 THEN (SELECT count(*)::int FROM whatsapp_conversaciones WHERE estado = 'abierta'
		                     AND asignado_a_user_id IS NULL AND bot_estado = 'derivada') ELSE 0 END,
		  CASE WHEN $11 THEN (SELECT count(*)::int FROM customer_follow_ups
		                      WHERE etapa <> 'cerrado' AND (proxima_accion_at IS NULL OR proxima_accion_at > $12)) ELSE 0 END,
		  CASE WHEN $7 THEN (SELECT count(*)::int FROM quotes WHERE estado IN ('pendiente', 'revision')
		                     AND (responde_hasta IS NULL OR responde_hasta >= $12)) ELSE 0 END`,
		ve("/admin/cortes"), ve("/admin/cheques"), ve("/admin/pagos"), ve("/admin/compras/ordenes"), ve("/admin/compras/facturas"),
		ve("/admin/facturacion"), ve("/admin/presupuestos"), ve("/admin/whatsapp"), hoy, hoy.AddDate(0, 0, 2), ve("/admin/clientes"), ahora).
		Scan(&o.cortesHoy, &o.chequesRechazados, &o.chequesInformados, &o.transferencias, &o.ordenesAtrasadas, &o.ordenesPorLlegar,
			&o.recepcionesSinFactura, &o.sinCAE, &o.presupuestosEnviados, &o.aceptadosSinPedido, &o.whatsappSinAsignar, &o.gestiones, &o.porResponder)
	if err != nil {
		return o, err
	}
	if tienda != "si" && (ve("/admin/precios") || ve("/admin/productos") || ve("/admin/stock")) {
		err = s.pool.QueryRow(ctx, `
			WITH medidas AS (
			  SELECT v.id, v.product_id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.active AND v.active
			)
			SELECT
			  CASE WHEN $1 THEN (SELECT count(*)::int FROM medidas m WHERE NOT EXISTS (
			    SELECT 1 FROM price_list_items i JOIN price_lists l ON l.id = i.price_list_id
			    WHERE i.variant_id = m.id AND l.is_default AND i.price > 0)) ELSE 0 END,
			  CASE WHEN $2 THEN (SELECT count(*)::int FROM medidas m WHERE NOT EXISTS (
			    SELECT 1 FROM product_images f WHERE f.product_id = m.product_id)) ELSE 0 END,
			  CASE WHEN $3 THEN (SELECT count(*)::int FROM product_variants v JOIN products p ON p.id = v.product_id
			    WHERE p.active AND v.active AND `+stock.CondicionSinStock+`) ELSE 0 END`,
			ve("/admin/precios"), ve("/admin/productos"), ve("/admin/stock")).Scan(&o.sinPrecio, &o.sinFoto, &o.sinStock)
		if err != nil {
			return o, err
		}
	}
	if ve("/admin/clientes") {
		deudas, err := s.deudaDeClientes(ctx, ahora)
		if err != nil {
			return o, err
		}
		for _, d := range deudas {
			if d[1] > 0.005 {
				o.clientesConVencido++
			}
		}
	}
	return o, nil
}

// RecepcionSinFactura: la recepción `g` no tiene ninguna factura de compra
// viva que la cubra (purchase_invoice_receipts: una factura puede cubrir
// varios remitos). La misma regla en el inicio y en el cierre (mes simulado,
// M3S2-034: el inicio miraba purchase_invoices.receipt_id y contaba 8 donde
// el cierre contaba 3). La factura la cubre por cualquiera de los dos
// caminos, como en la lista de recepciones (compras.FacturaDeLaRecepcion).
const RecepcionSinFactura = `NOT EXISTS (SELECT 1 FROM purchase_invoices f WHERE f.anulada_at IS NULL AND (f.receipt_id = g.id OR EXISTS (
	  SELECT 1 FROM purchase_invoice_receipts x WHERE x.purchase_invoice_id = f.id AND x.goods_receipt_id = g.id)))`
