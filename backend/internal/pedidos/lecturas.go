package pedidos

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/precios"
	"mjbj/internal/ventas"
	"mjbj/internal/ventas/fragmentos"
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

// ListarPresupuestos es listarPresupuestos: primero lo que tiene compromiso
// de respuesta más cerca, después la obra más cerca, después lo más nuevo.
// «abiertos» son los tres estados que todavía esperan algo.
func (s *Servicio) ListarPresupuestos(ctx context.Context, f Filtros) ([]PresupuestoListado, error) {
	var a argumentos
	var cond []string
	if f.Estado == "abiertos" {
		cond = append(cond, "q.estado IN ('pendiente', 'revision', 'enviado')")
	} else if f.Estado != "" && f.Estado != "todos" {
		cond = append(cond, "q.estado::text = "+a.poner(f.Estado))
	}
	if f.Sucursal != "" && f.Sucursal != "todos" {
		cond = append(cond, "b.slug = "+a.poner(f.Sucursal))
	}
	if f.Busqueda != "" {
		if c := a.coincide(f.Busqueda, "q.numero", "q.contacto_nombre", "c.razon_social"); c != "" {
			cond = append(cond, c)
		}
	}
	filas, err := s.pool.Query(ctx, `
		SELECT q.id, q.numero, q.contacto_nombre, c.razon_social, q.customer_id, b.name, q.estado::text, q.origen::text,
		       q.total::text, q.asesor, q.created_at, q.valido_hasta, q.responde_hasta, q.necesita_para, coalesce(conteo.items, 0),
		       (SELECT o.id FROM orders o WHERE o.quote_id = q.id ORDER BY o.created_at LIMIT 1),
		       (SELECT o.numero FROM orders o WHERE o.quote_id = q.id ORDER BY o.created_at LIMIT 1)
		FROM quotes q
		LEFT JOIN customers c ON c.id = q.customer_id
		LEFT JOIN branches b ON b.id = q.branch_id
		LEFT JOIN (SELECT quote_id, count(*)::int AS items FROM quote_items GROUP BY quote_id) conteo ON conteo.quote_id = q.id`+
		donde(cond)+`
		ORDER BY CASE WHEN q.responde_hasta IS NULL THEN 1 ELSE 0 END, q.responde_hasta ASC NULLS LAST,
		         q.necesita_para ASC NULLS LAST, q.created_at DESC`, a...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	ahora := s.ahora()
	out := []PresupuestoListado{}
	for filas.Next() {
		var p PresupuestoListado
		var total string
		if err := filas.Scan(&p.ID, &p.Numero, &p.Cliente, &p.Empresa, &p.CustomerID, &p.Sucursal, &p.Estado, &p.Origen, &total,
			&p.Asesor, &p.CreatedAt, &p.ValidoHasta, &p.RespondeHasta, &p.NecesitaPara, &p.Items, &p.PedidoID, &p.NumeroPedido); err != nil {
			return nil, err
		}
		p.Total = jsmath.Numero(total)
		p.Vencido = p.ValidoHasta != nil && p.ValidoHasta.UnixMilli() < ahora.UnixMilli() &&
			p.Estado != "aceptado" && p.Estado != "rechazado"
		if p.RespondeHasta != nil && p.Estado == "pendiente" {
			pl := EstadoDelPlazo(*p.RespondeHasta, ahora)
			p.Plazo = &pl
		}
		out = append(out, p)
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
	// Vencido: pasó su validez y no se convirtió. Para pasarlo a pedido hay
	// que elegir entre los precios de hoy (TotalDeHoy) y los suyos.
	Vencido    bool    `json:"vencido"`
	TotalDeHoy *string `json:"totalDeHoy"`
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
	if err := filas.Err(); err != nil {
		return nil, err
	}
	filas.Close()
	p.Vencido = p.PedidoID == nil && PresupuestoVencido(p.Estado, p.ValidoHasta, s.ahora())
	if p.Vencido {
		total, err := s.totalDeHoy(ctx, id, p.CustomerID, jsmath.Numero(p.Total)-jsmath.Numero(p.Subtotal))
		if err != nil {
			return nil, err
		}
		p.TotalDeHoy = &total
	}
	return &p, nil
}

// totalDeHoy es el total del presupuesto con los precios de lista de hoy
// (la misma cuenta que «actualizar» al pasarlo a pedido).
func (s *Servicio) totalDeHoy(ctx context.Context, id string, cliente *string, extra float64) (string, error) {
	filas, err := s.pool.Query(ctx, `SELECT variant_id, presentacion, cantidad::float8, subtotal::float8 FROM quote_items WHERE quote_id = $1 ORDER BY orden, id`, id)
	if err != nil {
		return "", err
	}
	type renglon struct {
		r        precios.RenglonConVariante
		cantidad float64
		subtotal float64
	}
	var rs []renglon
	for filas.Next() {
		var r renglon
		if err := filas.Scan(&r.r.VariantID, &r.r.Presentacion, &r.cantidad, &r.subtotal); err != nil {
			filas.Close()
			return "", err
		}
		rs = append(rs, r)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return "", err
	}
	lista, err := precios.ListaDelCliente(ctx, s.pool, cliente)
	if err != nil {
		return "", err
	}
	conVariante := make([]precios.RenglonConVariante, len(rs))
	for i, r := range rs {
		conVariante[i] = r.r
	}
	listas, err := precios.PreciosDeLista(ctx, s.pool, conVariante, lista)
	if err != nil {
		return "", err
	}
	total := 0.0
	for i, r := range rs {
		if listas[i] != nil {
			total += ventas.ACentavos(float64(r.cantidad * *listas[i]))
		} else {
			total += r.subtotal
		}
	}
	return jsmath.Fijo2(ventas.ACentavos(total + extra)), nil
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
	// SinCobrar es lo que falta cobrar fuera de la cuenta corriente
	// (fragmentos.SinCobrarDelPedido): la confirmación al entregar y el
	// «Cobrar $X» del reparto lo leen de acá, con la misma regla que «Me
	// deben».
	SinCobrar *float64 `json:"sinCobrar"`
	// PagoEnRevision: el cliente informó una transferencia que nadie
	// verificó (fragmentos.PagoEnRevision). No es «sin cobrar»: el reparto
	// no tiene que pedirle la plata otra vez.
	PagoEnRevision bool `json:"pagoEnRevision"`
	// EntregadoAt es el último paso a «entregado» del historial; nil si no
	// se entregó. «Sin cobrar» cuenta los días desde ahí.
	EntregadoAt *time.Time `json:"entregadoAt"`
}

// EstadoSinCobrar es el filtro del historial que lleva el renglón «N
// pedidos sin cobrar» de «Me deben»: los entregados a los que les falta
// cobrar, el más viejo primero (el primero a reclamar).
const EstadoSinCobrar = "sin-cobrar"

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
	orden := "o.created_at DESC"
	switch v.Vista {
	case "tablero":
		cond = append(cond, "(o.estado NOT IN ('entregado', 'cancelado') OR o.updated_at >= now() - interval '7 days')")
	case "historial":
		if f.Estado == "" || f.Estado == "todos" {
			cond = append(cond, "o.estado IN ('entregado', 'cancelado')")
		}
		if f.Estado == EstadoSinCobrar {
			cond = append(cond, "o.estado = 'entregado'", fragmentos.SinCobrarDelPedido+" > 0.009")
			orden = "o.created_at ASC"
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
	if f.Estado != "" && f.Estado != "todos" && f.Estado != EstadoSinCobrar {
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
		       coalesce(conteo.items, 0), o.customer_id, o.zona_envio, `+fragmentos.SinCobrarDelPedido+`::float8,
		       `+fragmentos.PagoEnRevision+`,
		       CASE WHEN o.estado = 'entregado' THEN (SELECT max(h.created_at) FROM order_status_history h
		                                             WHERE h.order_id = o.id AND h.estado = 'entregado') END
		FROM orders o
		LEFT JOIN customers c ON c.id = o.customer_id
		LEFT JOIN branches b ON b.id = o.branch_id
		LEFT JOIN (SELECT order_id, count(*)::int AS items FROM order_items GROUP BY order_id) conteo ON conteo.order_id = o.id`+
		donde(cond)+`
		ORDER BY `+orden+pie, a...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []PedidoListado{}
	for filas.Next() {
		var p PedidoListado
		var total string
		if err := filas.Scan(&p.ID, &p.Numero, &p.Cliente, &p.Empresa, &p.Sucursal, &p.SucursalSlug, &p.Estado, &p.TipoEntrega,
			&p.DireccionEntrega, &p.MedioPago, &p.EstadoPago, &total, &p.CreatedAt, &p.Items, &p.CustomerID, &p.ZonaEnvio, &p.SinCobrar,
			&p.PagoEnRevision, &p.EntregadoAt); err != nil {
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
	// SinCobrar: como en PedidoListado.
	SinCobrar *float64 `json:"sinCobrar"`
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
		       to_char(o.entregar_el, 'YYYY-MM-DD'), `+fragmentos.SinCobrarDelPedido+`::float8
		FROM orders o
		LEFT JOIN customers c ON c.id = o.customer_id
		LEFT JOIN branches b ON b.id = o.branch_id
		LEFT JOIN quotes q ON q.id = o.quote_id
		WHERE o.id = $1`, id).Scan(&p.ID, &p.Numero, &p.NumeroProvisorio, &p.Cliente, &p.Email, &p.Telefono, &p.Empresa,
		&p.BranchID, &p.CustomerID, &p.Sucursal, &p.Estado, &p.Origen, &p.TipoEntrega, &p.DireccionEntrega,
		&p.ZonaEnvio, &p.CostoEnvio, &p.Subtotal, &p.Descuento, &p.DescuentoMotivo, &p.Total,
		&p.MedioPago, &p.EstadoPago, &p.Notas, &p.CreatedAt, &p.QuoteID, &p.NumeroPresupuesto, &p.SaldoCliente, &p.EntregarEl, &p.SinCobrar)
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

// PedidoParaElTaller es la ficha del aserradero (T3, hallazgo 40): lo que se
// corta y para quién. La ficha completa le mostraba los precios, el saldo de
// la cuenta, el mail y el teléfono del cliente.
type PedidoParaElTaller struct {
	ID          string          `json:"id"`
	Numero      string          `json:"numero"`
	Cliente     string          `json:"cliente"`
	Empresa     *string         `json:"empresa"`
	CustomerID  *string         `json:"customerId"`
	BranchID    *string         `json:"branchId"`
	Sucursal    *string         `json:"sucursal"`
	Estado      string          `json:"estado"`
	TipoEntrega string          `json:"tipoEntrega"`
	EntregarEl  *string         `json:"entregarEl"`
	Notas       *string         `json:"notas"`
	Items       []ItemDelTaller `json:"items"`
}

// ItemDelTaller es un renglón sin precio.
type ItemDelTaller struct {
	VariantID    *string `json:"variantId"`
	Descripcion  string  `json:"descripcion"`
	Unidad       string  `json:"unidad"`
	Cantidad     string  `json:"cantidad"`
	Presentacion *string `json:"presentacion"`
}

// ParaElTaller lee esa ficha, o nil si el pedido no existe.
func (s *Servicio) ParaElTaller(ctx context.Context, id string) (*PedidoParaElTaller, error) {
	var p PedidoParaElTaller
	err := s.pool.QueryRow(ctx, `
		SELECT o.id, o.numero, o.contacto_nombre, c.razon_social, o.customer_id, o.branch_id, b.name, o.estado::text,
		       o.tipo_entrega::text, to_char(o.entregar_el, 'YYYY-MM-DD'), o.notas
		FROM orders o
		LEFT JOIN customers c ON c.id = o.customer_id
		LEFT JOIN branches b ON b.id = o.branch_id
		WHERE o.id = $1`, id).Scan(&p.ID, &p.Numero, &p.Cliente, &p.Empresa, &p.CustomerID, &p.BranchID, &p.Sucursal,
		&p.Estado, &p.TipoEntrega, &p.EntregarEl, &p.Notas)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `
		SELECT variant_id, descripcion, unidad, cantidad::text, presentacion
		FROM order_items WHERE order_id = $1 ORDER BY orden, id`, id)
	if err != nil {
		return nil, err
	}
	p.Items, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (ItemDelTaller, error) {
		var it ItemDelTaller
		err := r.Scan(&it.VariantID, &it.Descripcion, &it.Unidad, &it.Cantidad, &it.Presentacion)
		return it, err
	})
	if p.Items == nil {
		p.Items = []ItemDelTaller{}
	}
	return &p, err
}
