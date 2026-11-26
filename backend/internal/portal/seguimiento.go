package portal

import (
	"context"
	"crypto/subtle"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/cobros"
	"mjbj/internal/roles"
)

// Seguimiento es la página pública de un pedido (lib/dal/seguimiento.ts):
// la única que muestra datos de una persona sin exigir sesión, porque la
// mayoría compra sin cuenta.
//
// Lo que autoriza es el token del enlace, no el número (que es consecutivo
// y va en el remito). Sin token entra el dueño con sesión, o el personal.
// Para cualquier otro, ErrNoEsta: lo mismo que si no existiera, así probar
// números no dice cuáles existen.
type Seguimiento struct {
	ID               string             `json:"id"`
	Numero           string             `json:"numero"`
	PublicToken      string             `json:"publicToken"`
	Cliente          string             `json:"cliente"`
	Telefono         *string            `json:"telefono"`
	TipoEntrega      string             `json:"tipoEntrega"`
	DireccionEntrega *string            `json:"direccionEntrega"`
	ZonaEnvio        *string            `json:"zonaEnvio"`
	CostoEnvio       *string            `json:"costoEnvio"`
	Subtotal         string             `json:"subtotal"`
	Total            string             `json:"total"`
	MedioPago        *string            `json:"medioPago"`
	EstadoPago       string             `json:"estadoPago"`
	Estado           string             `json:"estado"`
	Sucursal         *string            `json:"sucursal"`
	SucursalSlug     *string            `json:"sucursalSlug"`
	CreatedAt        time.Time          `json:"createdAt"`
	Items            []RenglonDelPedido `json:"items"`
	customerID       *string
}

// RenglonDelPedido es lo que la página muestra de cada renglón: ni el costo
// ni la alícuota, que no tienen por qué salir por una ruta pública.
type RenglonDelPedido struct {
	ID             string  `json:"id"`
	VariantID      *string `json:"variantId"`
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       string  `json:"cantidad"`
	PrecioUnitario string  `json:"precioUnitario"`
	Subtotal       string  `json:"subtotal"`
	Presentacion   *string `json:"presentacion"`
	Orden          int32   `json:"orden"`
}

// Seguir devuelve el pedido si quien pregunta lo puede ver.
func (s *Servicio) Seguir(ctx context.Context, ses *auth.Sesion, numero, token string) (*Seguimiento, error) {
	var p Seguimiento
	err := s.pool.QueryRow(ctx, `
		SELECT o.id, o.numero, o.public_token::text, o.customer_id::text, o.contacto_nombre, o.contacto_telefono, o.tipo_entrega::text,
		  o.direccion_entrega, o.zona_envio, o.costo_envio::text, o.subtotal::text, o.total::text, o.medio_pago::text,
		  o.estado_pago::text, o.estado::text, b.name, b.slug, o.created_at
		FROM orders o LEFT JOIN branches b ON b.id = o.branch_id
		WHERE o.numero = $1`, numero).Scan(&p.ID, &p.Numero, &p.PublicToken, &p.customerID, &p.Cliente, &p.Telefono, &p.TipoEntrega,
		&p.DireccionEntrega, &p.ZonaEnvio, &p.CostoEnvio, &p.Subtotal, &p.Total, &p.MedioPago, &p.EstadoPago, &p.Estado,
		&p.Sucursal, &p.SucursalSlug, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	conToken := token != "" && subtle.ConstantTimeCompare([]byte(token), []byte(p.PublicToken)) == 1
	if !conToken {
		if ses == nil {
			return nil, ErrNoEsta
		}
		if ses.EsStaff() && !ses.Tiene(roles.QuienEntra("/admin/pedidos")...) {
			return nil, ErrNoEsta
		}
		if !ses.EsStaff() {
			c, err := s.ClienteDe(ctx, ses.UserID)
			if err != nil {
				return nil, err
			}
			if c == nil || p.customerID == nil || *p.customerID != c.ID {
				return nil, ErrNoEsta
			}
		}
	}
	filas, err := s.pool.Query(ctx, `SELECT id, variant_id, descripcion, unidad, cantidad::text, precio_unitario::text, subtotal::text,
		presentacion, orden FROM order_items WHERE order_id = $1 ORDER BY orden`, p.ID)
	if err != nil {
		return nil, err
	}
	p.Items, err = pgx.CollectRows(filas, pgx.RowToStructByPos[RenglonDelPedido])
	return &p, err
}

// PedidoPropio es miPedido: un pedido del cliente de la sesión, con sus
// renglones (sin costo) y su historial de estados. Los retiros y el acopio
// los da internal/entregas.
type PedidoPropio struct {
	ID               string             `json:"id"`
	Numero           string             `json:"numero"`
	Estado           string             `json:"estado"`
	EstadoPago       string             `json:"estadoPago"`
	MedioPago        *string            `json:"medioPago"`
	TipoEntrega      string             `json:"tipoEntrega"`
	DireccionEntrega *string            `json:"direccionEntrega"`
	ZonaEnvio        *string            `json:"zonaEnvio"`
	CostoEnvio       *string            `json:"costoEnvio"`
	Subtotal         string             `json:"subtotal"`
	Total            string             `json:"total"`
	Notas            *string            `json:"notas"`
	Sucursal         *string            `json:"sucursal"`
	SucursalSlug     *string            `json:"sucursalSlug"`
	CreatedAt        time.Time          `json:"createdAt"`
	Items            []RenglonDelPedido `json:"items"`
	Historial        []EstadoDelPedido  `json:"historial"`
	// Descuento es el que se repartió en los precios de los renglones: los
	// renglones ya lo traen, y el subtotal guardado es el de antes (H209).
	Descuento float64 `json:"descuento"`
	// DebeEnCuenta: ver Pedido.DebeEnCuenta.
	DebeEnCuenta *float64 `json:"debeEnCuenta"`
	// CuestaEnCuenta: ver Pedido.CuestaEnCuenta.
	CuestaEnCuenta *float64           `json:"cuestaEnCuenta"`
	Cortes         []CorteDelPedido   `json:"cortes"`
	Facturas       []FacturaDelPedido `json:"facturas"`
	Recibos        []ReciboDelPedido  `json:"recibos"`
	// Ajustes son las notas de crédito y de débito de la cuenta que nombran
	// al pedido (un faltante, una anulación): sin esto el pedido seguía
	// diciendo 120 m² y el cliente no veía la corrección (H302).
	Ajustes    []AjusteDelPedido `json:"ajustes"`
	EnRevision *float64          `json:"enRevision"`
	origen     string
}

// CorteDelPedido es un trabajo del taller atado al pedido (H210).
type CorteDelPedido struct {
	ID       string     `json:"id"`
	Numero   string     `json:"numero"`
	Estado   string     `json:"estado"`
	Material *string    `json:"material"`
	Placas   int32      `json:"placas"`
	RetiraEl *time.Time `json:"retiraEl"`
	// Piezas es el despiece: lo que el cliente viene a buscar.
	Piezas []PiezaDelCorte `json:"piezas" db:"-"`
}

// PiezaDelCorte es un renglón del despiece.
type PiezaDelCorte struct {
	LargoMm  int32   `json:"largoMm"`
	AnchoMm  int32   `json:"anchoMm"`
	Cantidad int32   `json:"cantidad"`
	Etiqueta *string `json:"etiqueta"`
}

// FacturaDelPedido es un comprobante emitido del pedido (H305).
type FacturaDelPedido struct {
	ID         string  `json:"id"`
	Tipo       string  `json:"tipo"`
	PuntoVenta int32   `json:"puntoVenta"`
	Numero     int32   `json:"numero"`
	Estado     string  `json:"estado"`
	Total      float64 `json:"total"`
}

// AjusteDelPedido es un asiento de la cuenta con la referencia del pedido.
type AjusteDelPedido struct {
	ID      string    `json:"id"`
	Tipo    string    `json:"tipo"`
	Monto   float64   `json:"monto"`
	Detalle *string   `json:"detalle"`
	Fecha   time.Time `json:"fecha"`
}

// ReciboDelPedido es un recibo que cobró el pedido (H305).
type ReciboDelPedido struct {
	ID     string  `json:"id"`
	Numero string  `json:"numero"`
	Estado string  `json:"estado"`
	Total  float64 `json:"total"`
}

// EstadoDelPedido es un paso del historial.
type EstadoDelPedido struct {
	ID        string    `json:"id"`
	Estado    string    `json:"estado"`
	Nota      *string   `json:"nota"`
	CreatedAt time.Time `json:"createdAt"`
}

// MiPedido busca por número **y** dueño juntos: si el filtro por dueño
// fuera después, ya se habría leído el pedido de otro.
func (s *Servicio) MiPedido(ctx context.Context, c *Cliente, numero string) (*PedidoPropio, error) {
	var p PedidoPropio
	err := s.pool.QueryRow(ctx, `
		SELECT o.id, o.numero, o.estado::text, o.estado_pago::text, o.medio_pago::text, o.tipo_entrega::text, o.direccion_entrega,
		  o.zona_envio, o.costo_envio::text, o.subtotal::text, o.total::text, o.notas, b.name, b.slug, o.created_at,
		  coalesce(o.descuento, 0)::float8, o.origen::text
		FROM orders o LEFT JOIN branches b ON b.id = o.branch_id
		WHERE o.numero = $1 AND o.customer_id = $2`, numero, c.ID).
		Scan(&p.ID, &p.Numero, &p.Estado, &p.EstadoPago, &p.MedioPago, &p.TipoEntrega, &p.DireccionEntrega, &p.ZonaEnvio,
			&p.CostoEnvio, &p.Subtotal, &p.Total, &p.Notas, &p.Sucursal, &p.SucursalSlug, &p.CreatedAt, &p.Descuento, &p.origen)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `SELECT id, variant_id, descripcion, unidad, cantidad::text, precio_unitario::text, subtotal::text,
		presentacion, orden FROM order_items WHERE order_id = $1 ORDER BY orden`, p.ID)
	if err != nil {
		return nil, err
	}
	if p.Items, err = pgx.CollectRows(filas, pgx.RowToStructByPos[RenglonDelPedido]); err != nil {
		return nil, err
	}
	filas, err = s.pool.Query(ctx, `SELECT id, estado::text, nota, created_at FROM order_status_history
		WHERE order_id = $1 ORDER BY created_at DESC`, p.ID)
	if err != nil {
		return nil, err
	}
	if p.Historial, err = pgx.CollectRows(filas, pgx.RowToStructByPos[EstadoDelPedido]); err != nil {
		return nil, err
	}
	paraElCliente(&p)

	filas, err = s.pool.Query(ctx, `SELECT id, numero, estado::text, material_descripcion, placas, retira_el::timestamptz
		FROM cutting_orders WHERE order_id = $1 AND estado <> 'cancelado' ORDER BY created_at`, p.ID)
	if err != nil {
		return nil, err
	}
	if p.Cortes, err = pgx.CollectRows(filas, pgx.RowToStructByPos[CorteDelPedido]); err != nil {
		return nil, err
	}
	for i := range p.Cortes {
		filas, err = s.pool.Query(ctx, `SELECT largo_mm, ancho_mm, cantidad, etiqueta FROM cutting_items
			WHERE cutting_order_id = $1 ORDER BY orden`, p.Cortes[i].ID)
		if err != nil {
			return nil, err
		}
		if p.Cortes[i].Piezas, err = pgx.CollectRows(filas, pgx.RowToStructByPos[PiezaDelCorte]); err != nil {
			return nil, err
		}
	}
	filas, err = s.pool.Query(ctx, `SELECT id, tipo::text, punto_venta, numero, estado::text, total::float8
		FROM invoices WHERE order_id = $1 AND customer_id = $2 AND estado <> 'borrador' ORDER BY fecha_emision, numero`, p.ID, c.ID)
	if err != nil {
		return nil, err
	}
	if p.Facturas, err = pgx.CollectRows(filas, pgx.RowToStructByPos[FacturaDelPedido]); err != nil {
		return nil, err
	}
	filas, err = s.pool.Query(ctx, `SELECT id, numero, estado::text, total::float8
		FROM receipts WHERE order_id = $1 AND customer_id = $2 ORDER BY created_at`, p.ID, c.ID)
	if err != nil {
		return nil, err
	}
	if p.Recibos, err = pgx.CollectRows(filas, pgx.RowToStructByPos[ReciboDelPedido]); err != nil {
		return nil, err
	}
	filas, err = s.pool.Query(ctx, `SELECT id, tipo::text, monto::float8, detalle, created_at FROM account_movements
		WHERE customer_id = $1 AND referencia = $2 AND tipo IN ('nota_credito', 'nota_debito', 'ajuste') ORDER BY created_at`, c.ID, p.Numero)
	if err != nil {
		return nil, err
	}
	if p.Ajustes, err = pgx.CollectRows(filas, pgx.RowToStructByPos[AjusteDelPedido]); err != nil {
		return nil, err
	}
	for i := range p.Ajustes {
		p.Ajustes[i].Detalle = cobros.DetalleParaElCliente(p.Ajustes[i].Detalle)
	}
	var revision float64
	if err := s.pool.QueryRow(ctx, `SELECT coalesce(sum(monto), 0)::float8 FROM payments
		WHERE order_id = $1 AND estado = 'en_revision'`, p.ID).Scan(&revision); err != nil {
		return nil, err
	}
	if revision > 0 {
		p.EnRevision = &revision
	}
	if p.MedioPago != nil && *p.MedioPago == "cuenta_corriente" {
		debe, neto, err := s.pendientesDeLaCuenta(ctx, c)
		if err != nil {
			return nil, err
		}
		if v, ok := debe[p.Numero]; ok {
			n := neto[p.Numero]
			p.DebeEnCuenta, p.CuestaEnCuenta = &v, &n
		}
	}
	return &p, nil
}

// paraElCliente saca lo que escribió la casa para la casa.
//
// Las notas del pedido las escribe el vendedor («Pidió por WhatsApp», «ojo,
// paga tarde») y la anulación les suma su motivo, que puede nombrar a otro
// cliente. El portal las mostraba como «Tu nota» (H084, H310, H386). Quedan
// solo las de un pedido hecho en la tienda, que escribió el cliente, sin lo
// que agregó la anulación; y del historial, los estados y las fechas.
func paraElCliente(p *PedidoPropio) {
	if p.origen != "tienda" {
		p.Notas = nil
	} else if p.Notas != nil {
		var propias []string
		for _, l := range strings.Split(*p.Notas, "\n") {
			if strings.HasPrefix(l, "Anulada: ") || l == "La mercadería no volvió." {
				continue
			}
			propias = append(propias, l)
		}
		t := strings.TrimSpace(strings.Join(propias, "\n"))
		p.Notas = nil
		if t != "" {
			p.Notas = &t
		}
	}
	for i := range p.Historial {
		p.Historial[i].Nota = nil
	}
}
