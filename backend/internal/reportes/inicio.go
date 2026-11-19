package reportes

import (
	"context"
	"sort"
	"time"

	"mjbj/internal/jsmath"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
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
	ReponerCentral         int      `json:"reponerCentral"`
	ReponerAserradero      int      `json:"reponerAserradero"`
	PedidosSinEntregar     int      `json:"pedidosSinEntregar"`
	ClientesConPedido      int      `json:"clientesConPedido"`
}

// MetricasDelResumen es metricasDelResumen: las ventas del período (hora
// argentina) contra el mismo lapso anterior, y los conteos del momento.
func (s *Servicio) MetricasDelResumen(ctx context.Context, p Periodo) (Metricas, error) {
	var m Metricas
	var actual, previo jsmath.Num
	err := s.pool.QueryRow(ctx, `
		SELECT
		  coalesce(sum(total) FILTER (WHERE estado <> 'cancelado' AND ($1::timestamptz IS NULL OR created_at >= $1)
		                                AND ($2::timestamptz IS NULL OR created_at < $2)), 0),
		  coalesce(sum(total) FILTER (WHERE $3::timestamptz IS NOT NULL AND estado <> 'cancelado'
		                                AND created_at >= $3 AND created_at < $4), 0),
		  (count(*) FILTER (WHERE estado NOT IN ('entregado', 'cancelado')))::int,
		  (count(DISTINCT customer_id) FILTER (WHERE estado NOT IN ('entregado', 'cancelado') AND customer_id IS NOT NULL))::int
		FROM orders`, p.Desde, p.Hasta, p.AnteriorDesde, p.AnteriorHasta).
		Scan(&actual, &previo, &m.PedidosSinEntregar, &m.ClientesConPedido)
	if err != nil {
		return m, err
	}
	err = s.pool.QueryRow(ctx, `
		SELECT
		  (SELECT (count(*) FILTER (WHERE estado IN ('pendiente', 'revision', 'enviado')))::int FROM quotes),
		  (SELECT (count(*) FILTER (WHERE estado = 'revision'))::int FROM quotes),
		  (SELECT count(*)::int FROM customers WHERE active = true),
		  (SELECT count(*)::int FROM inventory i JOIN product_variants v ON v.id = i.variant_id JOIN products p ON p.id = v.product_id
		     JOIN branches b ON b.id = i.branch_id
		     WHERE p.active AND v.active AND i.min_qty > 0 AND i.qty <= i.min_qty AND b.slug = 'casa-central'),
		  (SELECT count(*)::int FROM inventory i JOIN product_variants v ON v.id = i.variant_id JOIN products p ON p.id = v.product_id
		     JOIN branches b ON b.id = i.branch_id
		     WHERE p.active AND v.active AND i.min_qty > 0 AND i.qty <= i.min_qty AND b.slug = 'aserradero')`).
		Scan(&m.PresupuestosPendientes, &m.PresupuestosRevision, &m.ClientesActivos, &m.ReponerCentral, &m.ReponerAserradero)
	if err != nil {
		return m, err
	}
	m.VentasMes = actual.F()
	m.VariacionVentas = Variacion(actual.F(), previo.F())
	m.Reponer = m.ReponerCentral + m.ReponerAserradero
	return m, nil
}

// VentasDelMes es un mes del gráfico del resumen, por sucursal.
type VentasDelMes struct {
	Mes        string  `json:"mes"`
	Central    float64 `json:"central"`
	Aserradero float64 `json:"aserradero"`
}

// VentasPorSucursal es ventasPorSucursal del resumen: los últimos seis meses
// (argentinos), con los meses sin ventas en cero.
func (s *Servicio) VentasPorSucursal(ctx context.Context) ([]VentasDelMes, error) {
	ahora := s.ahora()
	rs, err := s.pool.Query(ctx, `
		SELECT to_char(o.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM'), b.slug, sum(o.total)
		FROM orders o LEFT JOIN branches b ON b.id = o.branch_id
		WHERE o.created_at >= $1 AND o.estado <> 'cancelado'
		GROUP BY 1, 2`, InicioDeMes(ahora, 5))
	if err != nil {
		return nil, err
	}
	defer rs.Close()
	central, aserradero := map[string]float64{}, map[string]float64{}
	for rs.Next() {
		var mes string
		var slug *string
		var total jsmath.Num
		if err := rs.Scan(&mes, &slug, &total); err != nil {
			return nil, err
		}
		if slug != nil && *slug == "casa-central" {
			central[mes] = total.F()
		}
		if slug != nil && *slug == "aserradero" {
			aserradero[mes] = total.F()
		}
	}
	if err := rs.Err(); err != nil {
		return nil, err
	}
	out := []VentasDelMes{}
	for i := 5; i >= 0; i-- {
		d := InicioDeMes(ahora, i)
		clave := claveDeMes(d)
		out = append(out, VentasDelMes{Mes: mesesDelResumen[d.Month()-1], Central: central[clave], Aserradero: aserradero[clave]})
	}
	return out, nil
}

// ParaReponer es una medida en el mínimo o por debajo, con su sucursal.
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
		SELECT v.id, p.id, p.name, v.label, b.name, i.qty, i.min_qty
		FROM inventory i
		JOIN product_variants v ON v.id = i.variant_id
		JOIN products p ON p.id = v.product_id
		JOIN branches b ON b.id = i.branch_id
		WHERE p.active AND v.active AND i.min_qty > 0 AND i.qty <= i.min_qty
		ORDER BY i.qty::float / nullif(i.min_qty, 0)
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
func (s *Servicio) PendientesDelRol(ctx context.Context, rol sqlc.StaffRole) ([]Pendiente, error) {
	ve := func(ruta string) bool { return roles.PuedeEntrar(ruta, &rol) }
	var c struct {
		porPreparar, listos, cortes, chequesVencidos, chequesPorVencer int
		comprasVencidas, comprasPorVencer, solicitudes, resenas        int
		reponer, seguimientos, presupuestos                            int
		chequesEn48, comprasEn48                                       int
	}
	ahora := s.ahora()
	err := s.pool.QueryRow(ctx, `
		SELECT
		  CASE WHEN $1 THEN (SELECT count(*) FILTER (WHERE estado IN ('pendiente', 'preparando'))::int FROM orders) ELSE 0 END,
		  CASE WHEN $1 THEN (SELECT count(*) FILTER (WHERE estado IN ('listo', 'en-camino'))::int FROM orders) ELSE 0 END,
		  CASE WHEN $2 THEN (SELECT count(*)::int FROM cutting_orders WHERE estado = 'en-cola') ELSE 0 END,
		  CASE WHEN $3 THEN (SELECT count(*) FILTER (WHERE fecha_pago < now())::int FROM cheques
		                     WHERE estado IN ('cartera', 'entregado', 'depositado')) ELSE 0 END,
		  CASE WHEN $3 THEN (SELECT count(*) FILTER (WHERE fecha_pago >= now() + interval '48 hours' AND fecha_pago < now() + interval '7 days')::int FROM cheques
		                     WHERE estado IN ('cartera', 'entregado', 'depositado')) ELSE 0 END,
		  CASE WHEN $4 THEN (SELECT count(*) FILTER (WHERE fecha_vencimiento < now())::int FROM purchase_invoices f
		                     WHERE fecha_vencimiento IS NOT NULL AND f.anulada_at IS NULL AND f.tipo::text NOT LIKE 'nota_credito%'
		                       AND f.total - coalesce((SELECT sum(a.importe) FROM supplier_payment_allocations a WHERE a.purchase_invoice_id = f.id), 0) > 0.01) ELSE 0 END,
		  CASE WHEN $4 THEN (SELECT count(*) FILTER (WHERE fecha_vencimiento >= now() + interval '48 hours' AND fecha_vencimiento < now() + interval '7 days')::int FROM purchase_invoices f
		                     WHERE fecha_vencimiento IS NOT NULL AND f.anulada_at IS NULL AND f.tipo::text NOT LIKE 'nota_credito%'
		                       AND f.total - coalesce((SELECT sum(a.importe) FROM supplier_payment_allocations a WHERE a.purchase_invoice_id = f.id), 0) > 0.01) ELSE 0 END,
		  CASE WHEN $5 THEN (SELECT count(*)::int FROM professional_applications WHERE estado = 'pendiente') ELSE 0 END,
		  CASE WHEN $6 THEN (SELECT count(*)::int FROM product_reviews WHERE estado = 'pendiente') ELSE 0 END,
		  CASE WHEN $7 THEN (SELECT count(*)::int FROM inventory i JOIN product_variants v ON v.id = i.variant_id
		                     JOIN products p ON p.id = v.product_id
		                     WHERE p.active AND v.active AND i.min_qty > 0 AND i.qty <= i.min_qty) ELSE 0 END,
		  CASE WHEN $8 THEN (SELECT count(*)::int FROM customer_follow_ups
		                     WHERE etapa <> 'cerrado' AND proxima_accion_at IS NOT NULL AND proxima_accion_at <= $10) ELSE 0 END,
		  CASE WHEN $9 THEN (SELECT count(*)::int FROM quotes WHERE estado = 'enviado'
		                     AND valido_hasta >= now() AND valido_hasta < now() + interval '3 days') ELSE 0 END,
		  CASE WHEN $3 THEN (SELECT count(*) FILTER (WHERE fecha_pago >= now() AND fecha_pago < now() + interval '48 hours')::int FROM cheques
		                     WHERE estado IN ('cartera', 'entregado', 'depositado')) ELSE 0 END,
		  CASE WHEN $4 THEN (SELECT count(*) FILTER (WHERE fecha_vencimiento >= now() AND fecha_vencimiento < now() + interval '48 hours')::int FROM purchase_invoices f
		                     WHERE fecha_vencimiento IS NOT NULL AND f.anulada_at IS NULL AND f.tipo::text NOT LIKE 'nota_credito%'
		                       AND f.total - coalesce((SELECT sum(a.importe) FROM supplier_payment_allocations a WHERE a.purchase_invoice_id = f.id), 0) > 0.01) ELSE 0 END`,
		ve("/admin/pedidos"), ve("/admin/cortes"), ve("/admin/cheques"), ve("/admin/compras/facturas"),
		ve("/admin/profesionales"), ve("/admin/contenido"), ve("/admin/stock"), ve("/admin/clientes"), ve("/admin/presupuestos"), ahora).
		Scan(&c.porPreparar, &c.listos, &c.cortes, &c.chequesVencidos, &c.chequesPorVencer, &c.comprasVencidas, &c.comprasPorVencer,
			&c.solicitudes, &c.resenas, &c.reponer, &c.seguimientos, &c.presupuestos, &c.chequesEn48, &c.comprasEn48)
	if err != nil {
		return nil, err
	}
	o, err := s.otrosPendientes(ctx, ve, ahora)
	if err != nil {
		return nil, err
	}
	f := []Pendiente{}
	agregar := func(n int, p Pendiente) {
		if n > 0 {
			p.Cantidad = n
			f = append(f, p)
		}
	}
	agregar(c.seguimientos, Pendiente{Clave: "seguimiento", Texto: uno(c.seguimientos, "cliente para llamar hoy", "clientes para llamar hoy"),
		Detalle: detalle("Seguimientos con la fecha cumplida"), Href: "/admin/clientes/seguimiento", Urgente: true})
	agregar(c.porPreparar, Pendiente{Clave: "preparar", Texto: uno(c.porPreparar, "pedido por preparar", "pedidos por preparar"),
		Detalle: detalle("Todavía no salieron a armarse"), Href: "/admin/pedidos", Urgente: true})
	agregar(c.listos, Pendiente{Clave: "entregar", Texto: uno(c.listos, "pedido listo sin entregar", "pedidos listos sin entregar"),
		Detalle: detalle("Armados y esperando que los retiren o salgan"), Href: "/admin/pedidos"})
	agregar(c.cortes, Pendiente{Clave: "cortes", Texto: uno(c.cortes, "corte en la cola", "cortes en la cola"),
		Detalle: detalle("Esperando la seccionadora"), Href: "/admin/cortes", Urgente: true})
	agregar(c.chequesVencidos, Pendiente{Clave: "cheques-vencidos", Texto: uno(c.chequesVencidos, "cheque pasado de fecha", "cheques pasados de fecha"),
		Detalle: detalle("Venció y sigue en cartera"), Href: "/admin/cheques", Urgente: true, Vencido: true})
	// Lo que vence en las próximas 48 horas es de hoy: un cheque que vence
	// mañana se deposita o se cubre hoy, no «esta semana».
	agregar(c.chequesEn48, Pendiente{Clave: "cheques-48h", Texto: uno(c.chequesEn48, "cheque vence en 48 horas", "cheques vencen en 48 horas"),
		Detalle: detalle("Los recibidos hay que depositarlos; los entregados, cubrirlos"), Href: "/admin/cheques", Urgente: true})
	agregar(c.chequesPorVencer, Pendiente{Clave: "cheques", Texto: uno(c.chequesPorVencer, "cheque vence esta semana", "cheques vencen esta semana"),
		Detalle: detalle("Los recibidos hay que depositarlos; los entregados, cubrirlos"), Href: "/admin/cheques"})
	agregar(c.comprasVencidas, Pendiente{Clave: "compras-vencidas", Texto: uno(c.comprasVencidas, "factura de compra vencida", "facturas de compra vencidas"),
		Detalle: detalle("Pasó el vencimiento y sigue sin pagarse del todo"), Href: "/admin/compras/facturas", Urgente: true, Vencido: true})
	agregar(c.comprasEn48, Pendiente{Clave: "compras-48h", Texto: uno(c.comprasEn48, "factura de compra vence en 48 horas", "facturas de compra vencen en 48 horas"),
		Href: "/admin/compras/facturas", Urgente: true})
	agregar(c.comprasPorVencer, Pendiente{Clave: "compras", Texto: uno(c.comprasPorVencer, "factura de compra vence esta semana", "facturas de compra vencen esta semana"),
		Href: "/admin/compras/facturas"})
	agregar(c.presupuestos, Pendiente{Clave: "presupuestos", Texto: uno(c.presupuestos, "presupuesto enviado vence en 3 días", "presupuestos enviados vencen en 3 días"),
		Detalle: detalle("Un llamado antes de que venza suele cerrar la venta"), Href: "/admin/presupuestos"})
	agregar(c.solicitudes, Pendiente{Clave: "profesionales", Texto: uno(c.solicitudes, "profesional esperando respuesta", "profesionales esperando respuesta"),
		Detalle: detalle("Pidieron la cuenta con precio de gremio"), Href: "/admin/profesionales"})
	agregar(c.reponer, Pendiente{Clave: "reponer", Texto: uno(c.reponer, "producto bajo el mínimo", "productos bajo el mínimo"),
		Detalle: detalle("Quedó en el mínimo o por debajo: hay que reponerlo"), Href: "/admin/stock"})
	agregar(c.resenas, Pendiente{Clave: "resenas", Texto: uno(c.resenas, "reseña sin moderar", "reseñas sin moderar"),
		Detalle: detalle("No se publican hasta que alguien las mire"), Href: "/admin/contenido"})
	agregar(o.whatsapp, Pendiente{Clave: "whatsapp", Texto: uno(o.whatsapp, "conversación de WhatsApp sin contestar", "conversaciones de WhatsApp sin contestar"),
		Href: "/admin/whatsapp?filtro=sin-leer", Urgente: true})
	agregar(o.presupuestosVencidos, Pendiente{Clave: "presupuestos-sin-responder", Texto: uno(o.presupuestosVencidos,
		"presupuesto pasado del plazo de respuesta", "presupuestos pasados del plazo de respuesta"),
		Href: "/admin/presupuestos?estado=abiertos", Urgente: true, Vencido: true})
	agregar(o.pedidosAtrasados, Pendiente{Clave: "pedidos-atrasados", Texto: uno(o.pedidosAtrasados, "pedido atrasado", "pedidos atrasados"),
		Href: "/admin/pedidos", Urgente: true, Vencido: true})
	agregar(o.cortesSinRetirar, Pendiente{Clave: "cortes-sin-retirar", Texto: uno(o.cortesSinRetirar, "corte terminado sin retirar", "cortes terminados sin retirar"),
		Href: "/admin/cortes"})
	agregar(o.clientesConVencido, Pendiente{Clave: "deuda-vencida", Texto: uno(o.clientesConVencido, "cliente con deuda vencida", "clientes con deuda vencida"),
		Href: "/admin/clientes", Urgente: true, Vencido: true})
	agregar(o.sinPrecio, Pendiente{Clave: "catalogo-precio", Texto: uno(o.sinPrecio, "medida sin precio", "medidas sin precio"), Href: "/admin/precios"})
	agregar(o.sinFoto, Pendiente{Clave: "catalogo-foto", Texto: uno(o.sinFoto, "medida sin foto", "medidas sin foto"), Href: "/admin/productos"})
	agregar(o.sinStock, Pendiente{Clave: "catalogo-stock", Texto: uno(o.sinStock, "medida sin stock", "medidas sin stock"), Href: "/admin/stock"})
	sort.SliceStable(f, func(i, j int) bool {
		if f[i].Urgente != f[j].Urgente {
			return f[i].Urgente
		}
		return f[j].Cantidad-f[i].Cantidad < 0
	})
	return f, nil
}

// otros son los pendientes que se sumaron en la revisión del 17/11: los que
// esperan una respuesta (WhatsApp, presupuestos), lo que se prometió y no
// salió (pedidos, cortes), la deuda vencida y, mientras la tienda está
// apagada, cuánto falta para cargar el catálogo.
type otros struct {
	whatsapp, presupuestosVencidos, pedidosAtrasados, cortesSinRetirar, clientesConVencido int
	sinPrecio, sinFoto, sinStock                                                           int
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
			  CASE WHEN $3 THEN (SELECT count(*)::int FROM medidas m WHERE NOT EXISTS (
			    SELECT 1 FROM inventory i WHERE i.variant_id = m.id AND i.qty > 0)) ELSE 0 END`,
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
