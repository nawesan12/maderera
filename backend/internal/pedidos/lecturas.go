package pedidos

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/zodjs"
)

// Las lecturas de lib/dal/admin/ventas.ts, con los mismos nombres de campo.
// Los numeric de las fichas van como texto («1500.00»), como los leía
// drizzle; los totales de los listados, como número.

type argumentos []any

func (a *argumentos) poner(v any) string {
	*a = append(*a, v)
	return fmt.Sprintf("$%d", len(*a))
}

// coincide es coincideBusqueda (lib/busqueda.ts): cada palabra (hasta seis)
// en alguna de las columnas, sin tildes.
func (a *argumentos) coincide(texto string, columnas ...string) string {
	terminos := strings.FieldsFunc(zodjs.TrimJS(texto), zodjs.EspacioJS)
	if len(terminos) > 6 {
		terminos = terminos[:6]
	}
	if len(terminos) == 0 {
		return ""
	}
	var porTermino []string
	for _, t := range terminos {
		p := a.poner("%" + t + "%")
		var col []string
		for _, c := range columnas {
			col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+p+")")
		}
		porTermino = append(porTermino, "("+strings.Join(col, " OR ")+")")
	}
	return "(" + strings.Join(porTermino, " AND ") + ")"
}

func donde(condiciones []string) string {
	if len(condiciones) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(condiciones, " AND ")
}

// Filtros son los de los dos listados.
type Filtros struct {
	Busqueda, Estado, Sucursal string
}

/* ------------------------------ presupuestos ------------------------------ */

// PresupuestoListado es una tarjeta del listado de presupuestos.
type PresupuestoListado struct {
	ID            string     `json:"id"`
	Numero        string     `json:"numero"`
	Cliente       string     `json:"cliente"`
	Empresa       *string    `json:"empresa"`
	CustomerID    *string    `json:"customerId"`
	Sucursal      *string    `json:"sucursal"`
	Estado        string     `json:"estado"`
	Origen        string     `json:"origen"`
	Total         float64    `json:"total"`
	Items         int        `json:"items"`
	Asesor        *string    `json:"asesor"`
	CreatedAt     time.Time  `json:"createdAt"`
	ValidoHasta   *time.Time `json:"validoHasta"`
	Vencido       bool       `json:"vencido"`
	RespondeHasta *time.Time `json:"respondeHasta"`
	NecesitaPara  *time.Time `json:"necesitaPara"`
	Plazo         *Plazo     `json:"plazo"`
	PedidoID      *string    `json:"pedidoId"`
	NumeroPedido  *string    `json:"numeroPedido"`
}

// PresupuestosPorPagina es el tope de una página de presupuestos.
const PresupuestosPorPagina = 30

// estadosAbiertos son los tres que todavía esperan algo.
var estadosAbiertos = []string{"pendiente", "revision", "enviado"}

// PaginaDePresupuestos es una página del listado con el total del filtro y
// la plata de todos los que pasan el filtro, no solo de los de la página.
type PaginaDePresupuestos struct {
	Filas []PresupuestoListado `json:"filas"`
	Total int                  `json:"total"`
	Monto float64              `json:"monto"`
}

// ListarPresupuestos es listarPresupuestos: primero lo que tiene compromiso
// de respuesta más cerca, después la obra más cerca, después lo más nuevo.
// «abiertos» son los tres estados que todavía esperan algo, y «cerrados»
// todos los demás; los cerrados van por fecha, del más nuevo al más viejo.
//
// De a páginas (tanda T8): los presupuestos se acumulan sin tope y la
// pantalla los traía todos. Sin límite, cualquier filtro trae una página,
// «abiertos» también: venía entero con el argumento de que son pocos por
// naturaleza, y no lo eran —un enviado que el cliente nunca contestó quedaba
// abierto para siempre (ver VencerPresupuestos)—. El monto del encabezado
// sale de la base, de todos. El id desempata, así dos páginas nunca se pisan.
func (s *Servicio) ListarPresupuestos(ctx context.Context, f Filtros, limite, desplazamiento int) (PaginaDePresupuestos, error) {
	out := PaginaDePresupuestos{Filas: []PresupuestoListado{}}
	var a argumentos
	var cond []string
	cerrados := false
	switch f.Estado {
	case "abiertos":
		cond = append(cond, "q.estado::text = ANY("+a.poner(estadosAbiertos)+")")
	case "cerrados":
		cond = append(cond, "NOT (q.estado::text = ANY("+a.poner(estadosAbiertos)+"))")
		cerrados = true
	case "", "todos":
	default:
		cond = append(cond, "q.estado::text = "+a.poner(f.Estado))
		cerrados = !slices.Contains(estadosAbiertos, f.Estado)
	}
	if f.Sucursal != "" && f.Sucursal != "todos" {
		cond = append(cond, "b.slug = "+a.poner(f.Sucursal))
	}
	if f.Busqueda != "" {
		if c := a.coincide(f.Busqueda, "q.numero", "q.contacto_nombre", "c.razon_social"); c != "" {
			cond = append(cond, c)
		}
	}
	desde := `
		FROM quotes q
		LEFT JOIN customers c ON c.id = q.customer_id
		LEFT JOIN branches b ON b.id = q.branch_id` + donde(cond)
	if err := s.pool.QueryRow(ctx, `SELECT count(*)::int, coalesce(sum(q.total), 0)::float8`+desde, a...).Scan(&out.Total, &out.Monto); err != nil {
		return out, err
	}
	switch {
	case limite <= 0:
		limite = PresupuestosPorPagina
	case limite > 200:
		limite = 200
	}
	desplazamiento = max(desplazamiento, 0)
	if out.Total == 0 || desplazamiento >= out.Total {
		return out, nil
	}
	orden := `CASE WHEN q.responde_hasta IS NULL THEN 1 ELSE 0 END, q.responde_hasta ASC NULLS LAST,
		         q.necesita_para ASC NULLS LAST, q.created_at DESC, q.id DESC`
	if cerrados {
		orden = `q.created_at DESC, q.id DESC`
	}
	// Los renglones y el pedido se cuentan con subconsultas en la lista: se
	// calculan solo para las filas de la página (antes se agrupaba
	// quote_items entero en cada carga).
	filas, err := s.pool.Query(ctx, `
		SELECT q.id, q.numero, q.contacto_nombre, c.razon_social, q.customer_id, b.name, q.estado::text, q.origen::text,
		       q.total::text, q.asesor, q.created_at, q.valido_hasta, q.responde_hasta, q.necesita_para,
		       (SELECT count(*)::int FROM quote_items qi WHERE qi.quote_id = q.id),
		       (SELECT o.id FROM orders o WHERE o.quote_id = q.id ORDER BY o.created_at LIMIT 1),
		       (SELECT o.numero FROM orders o WHERE o.quote_id = q.id ORDER BY o.created_at LIMIT 1)`+desde+`
		ORDER BY `+orden+`
		LIMIT `+a.poner(limite)+` OFFSET `+a.poner(desplazamiento), a...)
	if err != nil {
		return out, err
	}
	defer filas.Close()
	ahora := s.ahora()
	for filas.Next() {
		var p PresupuestoListado
		var total string
		if err := filas.Scan(&p.ID, &p.Numero, &p.Cliente, &p.Empresa, &p.CustomerID, &p.Sucursal, &p.Estado, &p.Origen, &total,
			&p.Asesor, &p.CreatedAt, &p.ValidoHasta, &p.RespondeHasta, &p.NecesitaPara, &p.Items, &p.PedidoID, &p.NumeroPedido); err != nil {
			return out, err
		}
		p.Total = jsmath.Numero(total)
		p.Vencido = p.ValidoHasta != nil && p.ValidoHasta.UnixMilli() < ahora.UnixMilli() &&
			p.Estado != "aceptado" && p.Estado != "rechazado"
		if p.RespondeHasta != nil && p.Estado == "pendiente" {
			pl := EstadoDelPlazo(*p.RespondeHasta, ahora)
			p.Plazo = &pl
		}
		out.Filas = append(out.Filas, p)
	}
	return out, filas.Err()
}

// ItemDePresupuesto es una línea de la ficha. AlicuotaIva sale del producto
// (para desagregar el IVA en el PDF); las líneas sueltas no tienen.
type ItemDePresupuesto struct {
	ID             string  `json:"id"`
	VariantID      *string `json:"variantId"`
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       string  `json:"cantidad"`
	PrecioUnitario string  `json:"precioUnitario"`
	Subtotal       string  `json:"subtotal"`
	Orden          int     `json:"orden"`
	AlicuotaIva    *string `json:"alicuotaIva"`
}

// FichaDePresupuesto es consultarPresupuesto.
type FichaDePresupuesto struct {
	ID                  string              `json:"id"`
	Numero              string              `json:"numero"`
	Cliente             string              `json:"cliente"`
	Email               *string             `json:"email"`
	Telefono            *string             `json:"telefono"`
	Empresa             *string             `json:"empresa"`
	CustomerID          *string             `json:"customerId"`
	ClienteCodigo       *string             `json:"clienteCodigo"`
	ClienteCuit         *string             `json:"clienteCuit"`
	ClienteCondicionIva *string             `json:"clienteCondicionIva"`
	ClienteDireccion    *string             `json:"clienteDireccion"`
	Sucursal            *string             `json:"sucursal"`
	SucursalSlug        *string             `json:"sucursalSlug"`
	Vendedor            *string             `json:"vendedor"`
	Estado              string              `json:"estado"`
	Origen              string              `json:"origen"`
	Subtotal            string              `json:"subtotal"`
	Total               string              `json:"total"`
	Notas               *string             `json:"notas"`
	Asesor              *string             `json:"asesor"`
	ValidoHasta         *time.Time          `json:"validoHasta"`
	CreatedAt           time.Time           `json:"createdAt"`
	Items               []ItemDePresupuesto `json:"items"`
	PedidoID            *string             `json:"pedidoId"`
	NumeroPedido        *string             `json:"numeroPedido"`
}

// Presupuesto es la ficha, o nil si no existe.
func (s *Servicio) Presupuesto(ctx context.Context, id string) (*FichaDePresupuesto, error) {
	var p FichaDePresupuesto
	err := s.pool.QueryRow(ctx, `
		SELECT q.id, q.numero, q.contacto_nombre, q.contacto_email, q.contacto_telefono, c.razon_social, q.customer_id,
		       c.codigo_legacy, c.cuit, c.condicion_iva::text, c.direccion, b.name, b.slug, v.nombre,
		       q.estado::text, q.origen::text, q.subtotal::text, q.total::text, q.notas, q.asesor, q.valido_hasta, q.created_at,
		       (SELECT o.id FROM orders o WHERE o.quote_id = q.id ORDER BY o.created_at LIMIT 1),
		       (SELECT o.numero FROM orders o WHERE o.quote_id = q.id ORDER BY o.created_at LIMIT 1)
		FROM quotes q
		LEFT JOIN customers c ON c.id = q.customer_id
		LEFT JOIN branches b ON b.id = q.branch_id
		LEFT JOIN sellers v ON v.id = q.seller_id
		WHERE q.id = $1`, id).Scan(&p.ID, &p.Numero, &p.Cliente, &p.Email, &p.Telefono, &p.Empresa, &p.CustomerID,
		&p.ClienteCodigo, &p.ClienteCuit, &p.ClienteCondicionIva, &p.ClienteDireccion, &p.Sucursal, &p.SucursalSlug, &p.Vendedor,
		&p.Estado, &p.Origen, &p.Subtotal, &p.Total, &p.Notas, &p.Asesor, &p.ValidoHasta, &p.CreatedAt, &p.PedidoID, &p.NumeroPedido)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `
		SELECT i.id, i.variant_id, i.descripcion, i.unidad, i.cantidad::text, i.precio_unitario::text, i.subtotal::text, i.orden,
		       p.alicuota_iva::text
		FROM quote_items i
		LEFT JOIN product_variants v ON v.id = i.variant_id
		LEFT JOIN products p ON p.id = v.product_id
		WHERE i.quote_id = $1
		ORDER BY i.orden, i.id`, id)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	p.Items = []ItemDePresupuesto{}
	for filas.Next() {
		var it ItemDePresupuesto
		if err := filas.Scan(&it.ID, &it.VariantID, &it.Descripcion, &it.Unidad, &it.Cantidad, &it.PrecioUnitario, &it.Subtotal,
			&it.Orden, &it.AlicuotaIva); err != nil {
			return nil, err
		}
		p.Items = append(p.Items, it)
	}
	return &p, filas.Err()
}

/* -------------------------------- pedidos -------------------------------- */

// PedidoListado es una tarjeta del tablero de pedidos.
type PedidoListado struct {
	ID               string    `json:"id"`
	Numero           string    `json:"numero"`
	Cliente          string    `json:"cliente"`
	Empresa          *string   `json:"empresa"`
	Sucursal         *string   `json:"sucursal"`
	SucursalSlug     *string   `json:"sucursalSlug"`
	Estado           string    `json:"estado"`
	TipoEntrega      string    `json:"tipoEntrega"`
	DireccionEntrega *string   `json:"direccionEntrega"`
	ZonaEnvio        *string   `json:"zonaEnvio"`
	MedioPago        *string   `json:"medioPago"`
	EstadoPago       string    `json:"estadoPago"`
	Total            float64   `json:"total"`
	Items            int       `json:"items"`
	CustomerID       *string   `json:"customerId"`
	CreatedAt        time.Time `json:"createdAt"`
}

// VistaDePedidos acota el listado: el tablero no necesita el historial
// entero (lo traía todo, desde el primer pedido), y el historial va por
// páginas y por período.
type VistaDePedidos struct {
	Vista        string // "", "tablero" o "historial"
	Desde, Hasta string // AAAA-MM-DD, del historial
	Pagina       int
}

// PorPaginaDeHistorial es cuántos pedidos trae cada página del historial.
const PorPaginaDeHistorial = 50

// ListarPedidos es listarPedidos: lo más nuevo primero.
func (s *Servicio) ListarPedidos(ctx context.Context, f Filtros) ([]PedidoListado, error) {
	return s.ListarPedidosEn(ctx, f, VistaDePedidos{})
}

// ListarPedidosEn es ListarPedidos con la vista del tablero o del historial.
func (s *Servicio) ListarPedidosEn(ctx context.Context, f Filtros, v VistaDePedidos) ([]PedidoListado, error) {
	var a argumentos
	var cond []string
	pie := ""
	switch v.Vista {
	case "tablero":
		cond = append(cond, "(o.estado NOT IN ('entregado', 'cancelado') OR o.updated_at >= now() - interval '7 days')")
	case "historial":
		if f.Estado == "" || f.Estado == "todos" {
			cond = append(cond, "o.estado IN ('entregado', 'cancelado')")
		}
		if v.Desde != "" {
			cond = append(cond, "o.created_at >= ("+a.poner(v.Desde)+"::date AT TIME ZONE 'America/Argentina/Buenos_Aires')")
		}
		if v.Hasta != "" {
			cond = append(cond, "o.created_at < (("+a.poner(v.Hasta)+"::date + 1) AT TIME ZONE 'America/Argentina/Buenos_Aires')")
		}
		pagina := v.Pagina
		if pagina < 1 {
			pagina = 1
		}
		pie = fmt.Sprintf(" LIMIT %d OFFSET %d", PorPaginaDeHistorial+1, (pagina-1)*PorPaginaDeHistorial)
	}
	if f.Estado != "" && f.Estado != "todos" {
		cond = append(cond, "o.estado::text = "+a.poner(f.Estado))
	}
	if f.Sucursal != "" && f.Sucursal != "todas" {
		cond = append(cond, "b.slug = "+a.poner(f.Sucursal))
	}
	if f.Busqueda != "" {
		if c := a.coincide(f.Busqueda, "o.numero", "o.contacto_nombre", "o.direccion_entrega", "c.razon_social"); c != "" {
			cond = append(cond, c)
		}
	}
	filas, err := s.pool.Query(ctx, `
		SELECT o.id, o.numero, o.contacto_nombre, c.razon_social, b.name, b.slug, o.estado::text, o.tipo_entrega::text,
		       o.direccion_entrega, o.medio_pago::text, o.estado_pago::text, o.total::text, o.created_at,
		       coalesce(conteo.items, 0), o.customer_id, o.zona_envio
		FROM orders o
		LEFT JOIN customers c ON c.id = o.customer_id
		LEFT JOIN branches b ON b.id = o.branch_id
		LEFT JOIN (SELECT order_id, count(*)::int AS items FROM order_items GROUP BY order_id) conteo ON conteo.order_id = o.id`+
		donde(cond)+`
		ORDER BY o.created_at DESC`+pie, a...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []PedidoListado{}
	for filas.Next() {
		var p PedidoListado
		var total string
		if err := filas.Scan(&p.ID, &p.Numero, &p.Cliente, &p.Empresa, &p.Sucursal, &p.SucursalSlug, &p.Estado, &p.TipoEntrega,
			&p.DireccionEntrega, &p.MedioPago, &p.EstadoPago, &total, &p.CreatedAt, &p.Items, &p.CustomerID, &p.ZonaEnvio); err != nil {
			return nil, err
		}
		p.Total = jsmath.Numero(total)
		out = append(out, p)
	}
	return out, filas.Err()
}

// ItemDePedido es la fila entera de order_items, como la devolvía drizzle.
type ItemDePedido struct {
	ID             string  `json:"id"`
	OrderID        string  `json:"orderId"`
	VariantID      *string `json:"variantId"`
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       string  `json:"cantidad"`
	PrecioUnitario string  `json:"precioUnitario"`
	Subtotal       string  `json:"subtotal"`
	Presentacion   *string `json:"presentacion"`
	StockPorUnidad float64 `json:"stockPorUnidad"`
	CostoUnitario  *string `json:"costoUnitario"`
	AlicuotaIva    *string `json:"alicuotaIva"`
	Orden          int     `json:"orden"`
}

// PasoDelPedido es una fila de order_status_history.
type PasoDelPedido struct {
	ID              string    `json:"id"`
	OrderID         string    `json:"orderId"`
	Estado          string    `json:"estado"`
	Nota            *string   `json:"nota"`
	CreatedByUserID *string   `json:"createdByUserId"`
	Quien           *string   `json:"quien"`
	CreatedAt       time.Time `json:"createdAt"`
}

// PagoDelPedido es cómo se pagó, con lote y cupón.
type PagoDelPedido struct {
	Medio    string  `json:"medio"`
	Importe  string  `json:"importe"`
	NroLote  *string `json:"nroLote"`
	NroCupon *string `json:"nroCupon"`
	Cuotas   int     `json:"cuotas"`
	Tarjeta  *string `json:"tarjeta"`
}

// FichaDePedido es obtenerPedido, más el margen (solo para el admin).
type FichaDePedido struct {
	ID               string          `json:"id"`
	Numero           string          `json:"numero"`
	NumeroProvisorio *string         `json:"numeroProvisorio"`
	Cliente          string          `json:"cliente"`
	Email            *string         `json:"email"`
	Telefono         *string         `json:"telefono"`
	Empresa          *string         `json:"empresa"`
	BranchID         *string         `json:"branchId"`
	CustomerID       *string         `json:"customerId"`
	Sucursal         *string         `json:"sucursal"`
	Estado           string          `json:"estado"`
	Origen           string          `json:"origen"`
	TipoEntrega      string          `json:"tipoEntrega"`
	DireccionEntrega *string         `json:"direccionEntrega"`
	ZonaEnvio        *string         `json:"zonaEnvio"`
	CostoEnvio       string          `json:"costoEnvio"`
	Subtotal         string          `json:"subtotal"`
	Descuento        string          `json:"descuento"`
	DescuentoMotivo  *string         `json:"descuentoMotivo"`
	Total            string          `json:"total"`
	MedioPago        *string         `json:"medioPago"`
	EstadoPago       string          `json:"estadoPago"`
	Notas            *string         `json:"notas"`
	CreatedAt        time.Time       `json:"createdAt"`
	Items            []ItemDePedido  `json:"items"`
	Historial        []PasoDelPedido `json:"historial"`
	Pagos            []PagoDelPedido `json:"pagos"`
	Margen           *Margen         `json:"margen"`
	// El presupuesto del que nació, para ir y volver entre las dos fichas.
	QuoteID           *string `json:"quoteId"`
	NumeroPresupuesto *string `json:"numeroPresupuesto"`
	// Lo que debe el cliente en su cuenta corriente, para cobrarle o no
	// entregarle sin preguntar. Nil si el pedido no tiene cliente.
	SaldoCliente *float64 `json:"saldoCliente"`
	// EntregarEl es el día comprometido (AAAA-MM-DD).
	EntregarEl *string `json:"entregarEl"`
}

// Pedido es la ficha, o nil si no existe. Con `conMargen`, el margen de la
// venta (es de administración: no se le muestra a quien vende).
func (s *Servicio) Pedido(ctx context.Context, id string, conMargen bool) (*FichaDePedido, error) {
	var p FichaDePedido
	err := s.pool.QueryRow(ctx, `
		SELECT o.id, o.numero, o.numero_provisorio, o.contacto_nombre, o.contacto_email, o.contacto_telefono, c.razon_social,
		       o.branch_id, o.customer_id, b.name, o.estado::text, o.origen::text, o.tipo_entrega::text, o.direccion_entrega,
		       o.zona_envio, o.costo_envio::text, o.subtotal::text, o.descuento::text, o.descuento_motivo, o.total::text,
		       o.medio_pago::text, o.estado_pago::text, o.notas, o.created_at, o.quote_id, q.numero,
		       CASE WHEN o.customer_id IS NULL THEN NULL
		            ELSE (SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE customer_id = o.customer_id) END,
		       to_char(o.entregar_el, 'YYYY-MM-DD')
		FROM orders o
		LEFT JOIN customers c ON c.id = o.customer_id
		LEFT JOIN branches b ON b.id = o.branch_id
		LEFT JOIN quotes q ON q.id = o.quote_id
		WHERE o.id = $1`, id).Scan(&p.ID, &p.Numero, &p.NumeroProvisorio, &p.Cliente, &p.Email, &p.Telefono, &p.Empresa,
		&p.BranchID, &p.CustomerID, &p.Sucursal, &p.Estado, &p.Origen, &p.TipoEntrega, &p.DireccionEntrega,
		&p.ZonaEnvio, &p.CostoEnvio, &p.Subtotal, &p.Descuento, &p.DescuentoMotivo, &p.Total,
		&p.MedioPago, &p.EstadoPago, &p.Notas, &p.CreatedAt, &p.QuoteID, &p.NumeroPresupuesto, &p.SaldoCliente, &p.EntregarEl)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	filas, err := s.pool.Query(ctx, `
		SELECT id, order_id, variant_id, descripcion, unidad, cantidad::text, precio_unitario::text, subtotal::text,
		       presentacion, stock_por_unidad::text, costo_unitario::text, alicuota_iva::text, orden
		FROM order_items WHERE order_id = $1 ORDER BY orden, id`, id)
	if err != nil {
		return nil, err
	}
	p.Items = []ItemDePedido{}
	for filas.Next() {
		var it ItemDePedido
		var factor string
		if err := filas.Scan(&it.ID, &it.OrderID, &it.VariantID, &it.Descripcion, &it.Unidad, &it.Cantidad, &it.PrecioUnitario,
			&it.Subtotal, &it.Presentacion, &factor, &it.CostoUnitario, &it.AlicuotaIva, &it.Orden); err != nil {
			filas.Close()
			return nil, err
		}
		it.StockPorUnidad = jsmath.Numero(factor)
		p.Items = append(p.Items, it)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}

	filas, err = s.pool.Query(ctx, `
		SELECT h.id, h.order_id, h.estado::text, h.nota, h.created_by_user_id, u.name, h.created_at
		FROM order_status_history h
		LEFT JOIN "user" u ON u.id = h.created_by_user_id
		WHERE h.order_id = $1 ORDER BY h.created_at DESC, h.id`, id)
	if err != nil {
		return nil, err
	}
	p.Historial = []PasoDelPedido{}
	for filas.Next() {
		var h PasoDelPedido
		if err := filas.Scan(&h.ID, &h.OrderID, &h.Estado, &h.Nota, &h.CreatedByUserID, &h.Quien, &h.CreatedAt); err != nil {
			filas.Close()
			return nil, err
		}
		p.Historial = append(p.Historial, h)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}

	// Vacío en las ventas anteriores a order_payments: ahí medioPago cuenta
	// la historia entera.
	filas, err = s.pool.Query(ctx, `
		SELECT medio::text, importe::text, nro_lote, nro_cupon, cuotas, tarjeta
		FROM order_payments WHERE order_id = $1 ORDER BY created_at, id`, id)
	if err != nil {
		return nil, err
	}
	p.Pagos = []PagoDelPedido{}
	for filas.Next() {
		var x PagoDelPedido
		if err := filas.Scan(&x.Medio, &x.Importe, &x.NroLote, &x.NroCupon, &x.Cuotas, &x.Tarjeta); err != nil {
			filas.Close()
			return nil, err
		}
		p.Pagos = append(p.Pagos, x)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}

	if conMargen {
		lineas := make([]LineaConCosto, len(p.Items))
		for i, it := range p.Items {
			lineas[i] = LineaConCosto{Subtotal: it.Subtotal, Cantidad: it.Cantidad, AlicuotaIva: it.AlicuotaIva, CostoUnitario: it.CostoUnitario}
		}
		p.Margen = MargenDelPedido(lineas)
	}
	return &p, nil
}
