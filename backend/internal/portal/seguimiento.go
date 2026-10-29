package portal

import (
	"context"
	"crypto/subtle"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
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
