package clientes

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
)

// ClienteListado es una fila de la cartera (lib/dal/admin/clientes.ts), con
// lo que deudaPorCliente sumaba aparte: lo vencido y la prioridad de
// cobranza, solo para quien debe.
type ClienteListado struct {
	ID              string          `json:"id"`
	Nombre          string          `json:"nombre"`
	RazonSocial     *string         `json:"razonSocial"`
	Cuit            *string         `json:"cuit"`
	Rubro           *string         `json:"rubro"`
	Tipo            string          `json:"tipo"`
	Estado          string          `json:"estado"`
	Asesor          *string         `json:"asesor"`
	Telefono        *string         `json:"telefono"`
	Email           *string         `json:"email"`
	Saldo           float64         `json:"saldo"`
	LimiteCredito   float64         `json:"limiteCredito"`
	DiasCredito     int32           `json:"diasCredito"`
	CuentaBloqueada bool            `json:"cuentaBloqueada"`
	MotivoBloqueo   *string         `json:"motivoBloqueo"`
	TotalComprado   float64         `json:"totalComprado"`
	UltimaCompra    *time.Time      `json:"ultimaCompra"`
	Deuda           *DeudaDeCliente `json:"deuda"`
}

// DeudaDeCliente es lo que daba deudaPorCliente.
type DeudaDeCliente struct {
	Vencido          float64          `json:"vencido"`
	DiasDeLaMasVieja *int             `json:"diasDeLaMasVieja"`
	Prioridad        cobros.Prioridad `json:"prioridad"`
}

// FiltrosDeClientes son los de la cartera.
type FiltrosDeClientes struct{ Busqueda, Tipo, Rubro, Vendedor string }

func terminos(texto string) []string {
	t := strings.Fields(texto)
	if len(t) > 6 {
		t = t[:6]
	}
	return t
}

// Listar es listarClientes: los activos por nombre, con su saldo, lo que
// compraron y la deuda vencida de quien debe.
func (s *Servicio) Listar(ctx context.Context, f FiltrosDeClientes, hoy time.Time) ([]ClienteListado, error) {
	cond := []string{"c.active"}
	var args []any
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	if f.Tipo != "" && f.Tipo != "todos" {
		cond = append(cond, "c.tipo::text = "+arg(f.Tipo))
	}
	switch {
	case f.Rubro == "sin-rubro":
		cond = append(cond, "(c.rubro IS NULL OR c.rubro = '')")
	case f.Rubro != "" && f.Rubro != "todos":
		cond = append(cond, "c.rubro = "+arg(f.Rubro))
	}
	if f.Vendedor != "" {
		cond = append(cond, "c.seller_id::text = "+arg(f.Vendedor))
	}
	for _, t := range terminos(f.Busqueda) {
		p := arg("%" + t + "%")
		var col []string
		for _, c := range []string{"c.nombre", "c.razon_social", "c.cuit", "c.rubro", "c.email"} {
			col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+p+")")
		}
		cond = append(cond, "("+strings.Join(col, " OR ")+")")
	}
	filas, err := s.pool.Query(ctx, `
		SELECT c.id, c.nombre, c.razon_social, c.cuit, c.rubro, c.tipo::text, c.estado::text, c.asesor, c.telefono, c.email,
		  coalesce(sa.saldo, 0)::float8, c.limite_credito::float8, c.dias_credito, c.cuenta_bloqueada, c.motivo_bloqueo,
		  coalesce(co.total, 0)::float8, co.ultima
		FROM customers c
		LEFT JOIN (SELECT customer_id, sum(monto) AS saldo FROM account_movements GROUP BY customer_id) sa ON sa.customer_id = c.id
		LEFT JOIN (SELECT customer_id, sum(total) AS total, max(created_at) AS ultima FROM orders WHERE estado <> 'cancelado' GROUP BY customer_id) co
		  ON co.customer_id = c.id
		WHERE `+strings.Join(cond, " AND ")+`
		ORDER BY c.nombre`, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (ClienteListado, error) {
		var c ClienteListado
		err := r.Scan(&c.ID, &c.Nombre, &c.RazonSocial, &c.Cuit, &c.Rubro, &c.Tipo, &c.Estado, &c.Asesor, &c.Telefono, &c.Email,
			&c.Saldo, &c.LimiteCredito, &c.DiasCredito, &c.CuentaBloqueada, &c.MotivoBloqueo, &c.TotalComprado, &c.UltimaCompra)
		return c, err
	})
	if err != nil {
		return nil, err
	}
	// La deuda vencida, de los que deben.
	var deudores []string
	for _, c := range out {
		if c.Saldo > 0 {
			deudores = append(deudores, c.ID)
		}
	}
	if len(deudores) == 0 {
		return out, nil
	}
	movs, err := s.pool.Query(ctx, `SELECT customer_id::text, monto::float8, created_at FROM account_movements WHERE customer_id = ANY($1::uuid[])`, deudores)
	if err != nil {
		return nil, err
	}
	porCliente := map[string][]cobros.Movimiento{}
	var id string
	var m cobros.Movimiento
	if _, err := pgx.ForEachRow(movs, []any{&id, &m.Monto, &m.Fecha}, func() error {
		porCliente[id] = append(porCliente[id], m)
		return nil
	}); err != nil {
		return nil, err
	}
	for i := range out {
		c := &out[i]
		if c.Saldo <= 0 {
			continue
		}
		a := cobros.CalcularAging(porCliente[c.ID], hoy)
		vencido := 0.0
		for _, t := range a.Tramos {
			if t.Desde > int(c.DiasCredito) {
				vencido += t.Monto
			}
		}
		c.Deuda = &DeudaDeCliente{Vencido: vencido, DiasDeLaMasVieja: a.DiasDeLaMasVieja,
			Prioridad: cobros.PrioridadDeCobranza(cobros.Deuda{Vencido: vencido, DiasDeLaMasVieja: a.DiasDeLaMasVieja,
				DiasCredito: int(c.DiasCredito), Bloqueada: c.CuentaBloqueada})}
	}
	return out, nil
}

// Ficha es obtenerCliente: la fila entera de customers (como la daba
// drizzle: los importes como texto), el vendedor, la cuenta web que se
// podría vincular, el saldo y los últimos pedidos y presupuestos.
type Ficha struct {
	ID                   string        `json:"id"`
	UserID               *string       `json:"userId"`
	Nombre               string        `json:"nombre"`
	RazonSocial          *string       `json:"razonSocial"`
	Cuit                 *string       `json:"cuit"`
	CondicionIva         string        `json:"condicionIva"`
	Email                *string       `json:"email"`
	Telefono             *string       `json:"telefono"`
	Direccion            *string       `json:"direccion"`
	Rubro                *string       `json:"rubro"`
	Tipo                 string        `json:"tipo"`
	Estado               string        `json:"estado"`
	PriceListID          *string       `json:"priceListId"`
	LimiteCredito        string        `json:"limiteCredito"`
	Asesor               *string       `json:"asesor"`
	Notas                *string       `json:"notas"`
	Active               bool          `json:"active"`
	CreatedAt            time.Time     `json:"createdAt"`
	UpdatedAt            time.Time     `json:"updatedAt"`
	CodigoLegacy         *string       `json:"codigoLegacy"`
	SellerID             *string       `json:"sellerId"`
	DiasCredito          int32         `json:"diasCredito"`
	CuentaBloqueada      bool          `json:"cuentaBloqueada"`
	MotivoBloqueo        *string       `json:"motivoBloqueo"`
	Vendedor             *string       `json:"vendedor"`
	CuentaWebSinVincular *CuentaWeb    `json:"cuentaWebSinVincular"`
	Saldo                float64       `json:"saldo"`
	Pedidos              []Comprobante `json:"pedidos"`
	Presupuestos         []Comprobante `json:"presupuestos"`
}

// CuentaWeb es una ficha creada desde el sitio con el mismo correo.
type CuentaWeb struct {
	ID        string    `json:"id"`
	Nombre    string    `json:"nombre"`
	CreatedAt time.Time `json:"createdAt"`
}

// Comprobante es un pedido o un presupuesto de la ficha.
type Comprobante struct {
	ID        string    `json:"id"`
	Numero    string    `json:"numero"`
	Estado    string    `json:"estado"`
	Total     string    `json:"total"`
	CreatedAt time.Time `json:"createdAt"`
}

// ErrNoEsta es una ficha que no existe.
var ErrNoEsta = errors.New("no está")

func comprobantes(ctx context.Context, s *Servicio, sql, id string) ([]Comprobante, error) {
	filas, err := s.pool.Query(ctx, sql, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Comprobante, error) {
		var c Comprobante
		return c, r.Scan(&c.ID, &c.Numero, &c.Estado, &c.Total, &c.CreatedAt)
	})
}

// Obtener es obtenerCliente; ErrNoEsta si no hay ficha.
func (s *Servicio) Obtener(ctx context.Context, id string) (*Ficha, error) {
	var c Ficha
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, c.user_id, c.nombre, c.razon_social, c.cuit, c.condicion_iva::text, c.email, c.telefono, c.direccion, c.rubro,
		  c.tipo::text, c.estado::text, c.price_list_id, c.limite_credito::text, c.asesor, c.notas, c.active, c.created_at, c.updated_at,
		  c.codigo_legacy, c.seller_id, c.dias_credito, c.cuenta_bloqueada, c.motivo_bloqueo, s.nombre,
		  (SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE customer_id = c.id)
		FROM customers c LEFT JOIN sellers s ON s.id = c.seller_id
		WHERE c.id = $1`, id).Scan(&c.ID, &c.UserID, &c.Nombre, &c.RazonSocial, &c.Cuit, &c.CondicionIva, &c.Email, &c.Telefono,
		&c.Direccion, &c.Rubro, &c.Tipo, &c.Estado, &c.PriceListID, &c.LimiteCredito, &c.Asesor, &c.Notas, &c.Active, &c.CreatedAt,
		&c.UpdatedAt, &c.CodigoLegacy, &c.SellerID, &c.DiasCredito, &c.CuentaBloqueada, &c.MotivoBloqueo, &c.Vendedor, &c.Saldo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	if c.UserID == nil && c.Email != nil && *c.Email != "" {
		var w CuentaWeb
		err := s.pool.QueryRow(ctx, `SELECT id, nombre, created_at FROM customers
			WHERE email = $1 AND active AND user_id IS NOT NULL AND id <> $2 LIMIT 1`, *c.Email, c.ID).Scan(&w.ID, &w.Nombre, &w.CreatedAt)
		if err == nil {
			c.CuentaWebSinVincular = &w
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	if c.Pedidos, err = comprobantes(ctx, s, `SELECT id, numero, estado::text, total::text, created_at FROM orders
		WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10`, id); err != nil {
		return nil, err
	}
	if c.Presupuestos, err = comprobantes(ctx, s, `SELECT id, numero, estado::text, total::text, created_at FROM quotes
		WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10`, id); err != nil {
		return nil, err
	}
	return &c, nil
}

// Vendedor es un vendedor con la cantidad de clientes en su cartera.
type Vendedor struct {
	ID       string `json:"id"`
	Nombre   string `json:"nombre"`
	Tipo     string `json:"tipo"`
	Activo   bool   `json:"activo"`
	Clientes int    `json:"clientes"`
}

// Vendedores es listarVendedores (o vendedoresActivos, con soloActivos).
func (s *Servicio) Vendedores(ctx context.Context, soloActivos bool) ([]Vendedor, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT s.id, s.nombre, s.tipo::text, s.activo, count(c.id)::int
		FROM sellers s LEFT JOIN customers c ON c.seller_id = s.id
		WHERE $1 = false OR s.activo
		GROUP BY s.id ORDER BY s.nombre`, soloActivos)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Vendedor, error) {
		var v Vendedor
		return v, r.Scan(&v.ID, &v.Nombre, &v.Tipo, &v.Activo, &v.Clientes)
	})
}

// Gestion es un seguimiento de la lista.
type Gestion struct {
	ID              string     `json:"id"`
	CustomerID      string     `json:"customerId"`
	Cliente         string     `json:"cliente"`
	Etapa           string     `json:"etapa"`
	Asunto          string     `json:"asunto"`
	Notas           *string    `json:"notas"`
	ProximaAccionAt *time.Time `json:"proximaAccionAt"`
	Vencida         bool       `json:"vencida"`
	CreatedAt       time.Time  `json:"createdAt"`
}

// Gestiones es listarGestiones (y gestionesDelCliente, con un cliente): las
// abiertas, o todas; la próxima acción más cercana primero.
func (s *Servicio) Gestiones(ctx context.Context, incluirCerradas bool, cliente string, hoy time.Time) ([]Gestion, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT g.id, g.customer_id, coalesce(c.razon_social, c.nombre), g.etapa::text, g.asunto, g.notas, g.proxima_accion_at, g.created_at
		FROM customer_follow_ups g JOIN customers c ON c.id = g.customer_id
		WHERE ($1 OR g.etapa <> 'cerrado') AND ($2 = '' OR g.customer_id::text = $2)
		ORDER BY g.proxima_accion_at ASC NULLS LAST, g.created_at DESC`, incluirCerradas, cliente)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Gestion, error) {
		var g Gestion
		err := r.Scan(&g.ID, &g.CustomerID, &g.Cliente, &g.Etapa, &g.Asunto, &g.Notas, &g.ProximaAccionAt, &g.CreatedAt)
		g.Vencida = g.ProximaAccionAt != nil && !g.ProximaAccionAt.After(hoy)
		return g, err
	})
}

// GestionesVencidas es cuántas abiertas tienen la próxima acción vencida.
func (s *Servicio) GestionesVencidas(ctx context.Context, hoy time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*)::int FROM customer_follow_ups
		WHERE etapa <> 'cerrado' AND proxima_accion_at IS NOT NULL AND proxima_accion_at <= $1`, hoy).Scan(&n)
	return n, err
}
