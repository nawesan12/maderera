package pagos

import (
	"context"
	"crypto/subtle"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/reportes"
)

// --- lib/dal/pagos.ts ---

// CobroDelPedido es el último intento de cobro de un pedido.
type CobroDelPedido struct {
	ID             string    `json:"id"`
	Estado         string    `json:"estado"`
	Proveedor      string    `json:"proveedor"`
	Monto          float64   `json:"monto"`
	ComprobanteURL *string   `json:"comprobanteUrl"`
	MotivoRechazo  *string   `json:"motivoRechazo"`
	CreatedAt      time.Time `json:"createdAt"`
}

// PedidoAutorizado es pedidoAutorizado (lib/dal/seguimiento.ts): el pedido
// solo si quien pregunta puede tocarlo (el token, el dueño con sesión o el
// personal). nil también si no existe: no se distingue.
type PedidoAutorizado struct {
	ID         string
	Numero     string
	CustomerID *string
	Total      float64
	EstadoPago string
}

// Autorizado lee el pedido por número y decide.
func (s *Servicio) Autorizado(ctx context.Context, numero, token string, ses *auth.Sesion) (*PedidoAutorizado, error) {
	var p PedidoAutorizado
	var publico string
	var total jsmath.Num
	err := s.pool.QueryRow(ctx, `SELECT id, numero, public_token, customer_id, total, estado_pago::text FROM orders WHERE numero = $1 LIMIT 1`,
		numero).Scan(&p.ID, &p.Numero, &publico, &p.CustomerID, &total, &p.EstadoPago)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.Total = float64(total)
	if token != "" && subtle.ConstantTimeCompare([]byte(token), []byte(publico)) == 1 {
		return &p, nil
	}
	if ses == nil {
		return nil, nil
	}
	if ses.EsStaff() {
		return &p, nil
	}
	var cliente string
	err = s.pool.QueryRow(ctx, `SELECT id FROM customers WHERE user_id = $1 AND active LIMIT 1`, ses.UserID).Scan(&cliente)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if p.CustomerID == nil || *p.CustomerID != cliente {
		return nil, nil
	}
	return &p, nil
}

// CobroDePedido es cobroDelPedido, para la página de seguimiento: con el
// mismo permiso que esa página (token, dueño o personal).
func (s *Servicio) CobroDePedido(ctx context.Context, numero, token string, ses *auth.Sesion) (*CobroDelPedido, bool, error) {
	p, err := s.Autorizado(ctx, numero, token, ses)
	if err != nil || p == nil {
		return nil, false, err
	}
	var c CobroDelPedido
	var monto jsmath.Num
	err = s.pool.QueryRow(ctx, `
		SELECT id, estado::text, proveedor::text, monto, comprobante_url, motivo_rechazo, created_at
		FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, p.ID).
		Scan(&c.ID, &c.Estado, &c.Proveedor, &monto, &c.ComprobanteURL, &c.MotivoRechazo, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, true, nil
	}
	if err != nil {
		return nil, true, err
	}
	c.Monto = float64(monto)
	return &c, true, nil
}

// CobroSimulado es lo que muestra la pantalla de demostración.
type CobroSimulado struct {
	ID       string  `json:"id"`
	Monto    float64 `json:"monto"`
	Estado   string  `json:"estado"`
	Tipo     string  `json:"tipo"`
	Concepto string  `json:"concepto"`
	VolverA  string  `json:"volverA"`
}

// Simulado es cobroSimulado: **solo cobros del proveedor demo** (si no, la
// pantalla aprobaría a mano un cobro real).
func (s *Servicio) Simulado(ctx context.Context, pagoID string) (*CobroSimulado, error) {
	if !plataforma.UUIDValido(pagoID) {
		return nil, nil
	}
	var c CobroSimulado
	var monto jsmath.Num
	var proveedor string
	var numero, token, cliente, evento, slug *string
	err := s.pool.QueryRow(ctx, `
		SELECT p.id, p.monto, p.estado::text, p.tipo::text, p.proveedor::text, o.numero, o.public_token, c.nombre, e.titulo, e.slug
		FROM payments p
		LEFT JOIN orders o ON o.id = p.order_id
		LEFT JOIN customers c ON c.id = p.customer_id
		LEFT JOIN event_registrations r ON r.payment_id = p.id
		LEFT JOIN events e ON e.id = r.event_id
		WHERE p.id = $1 LIMIT 1`, pagoID).Scan(&c.ID, &monto, &c.Estado, &c.Tipo, &proveedor, &numero, &token, &cliente, &evento, &slug)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && proveedor != "demo") {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.Monto = float64(monto)
	switch {
	case numero != nil:
		c.Concepto, c.VolverA = "Pedido "+*numero, EnlaceDeSeguimiento(*numero, *token)
	case evento != nil:
		c.Concepto = *evento
	default:
		c.Concepto = "Cuenta corriente"
		if cliente != nil && *cliente != "" {
			c.Concepto += " · " + *cliente
		}
	}
	if numero == nil {
		if slug != nil && *slug != "" {
			c.VolverA = "/eventos/" + *slug
		} else {
			c.VolverA = "/mi-cuenta/cuenta-corriente"
		}
	}
	return &c, nil
}

// DatosParaTransferir son los datos bancarios; nil si no se cargaron.
type DatosParaTransferir struct {
	Banco         string  `json:"banco"`
	Titular       string  `json:"titular"`
	Cuit          string  `json:"cuit"`
	Cbu           string  `json:"cbu"`
	Alias         string  `json:"alias"`
	Instrucciones *string `json:"instrucciones"`
}

func (s *Servicio) datosBancarios(ctx context.Context) (*DatosParaTransferir, *string, error) {
	var d DatosParaTransferir
	var id string
	err := s.pool.QueryRow(ctx, `SELECT id, banco, titular, cuit, cbu, alias, instrucciones FROM datos_bancarios LIMIT 1`).
		Scan(&id, &d.Banco, &d.Titular, &d.Cuit, &d.Cbu, &d.Alias, &d.Instrucciones)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return &d, &id, nil
}

// --- lib/dal/admin/pagos.ts ---

// PagoListado es una fila de la conciliación.
type PagoListado struct {
	ID                 string     `json:"id"`
	Tipo               string     `json:"tipo"`
	Proveedor          string     `json:"proveedor"`
	Estado             string     `json:"estado"`
	Monto              float64    `json:"monto"`
	Medio              *string    `json:"medio"`
	ComprobanteURL     *string    `json:"comprobanteUrl"`
	MotivoRechazo      *string    `json:"motivoRechazo"`
	ProveedorPaymentID *string    `json:"proveedorPaymentId"`
	NumeroPedido       *string    `json:"numeroPedido"`
	OrderID            *string    `json:"orderId"`
	Cliente            *string    `json:"cliente"`
	CustomerID         *string    `json:"customerId"`
	CreatedAt          time.Time  `json:"createdAt"`
	AcreditadoAt       *time.Time `json:"acreditadoAt"`
}

// Listar es listarPagos: los últimos 300, del período.
func (s *Servicio) Listar(ctx context.Context, estado string, desde *time.Time) ([]PagoListado, error) {
	var e *string
	if estado != "" {
		e = &estado
	}
	filas, err := s.pool.Query(ctx, `
		SELECT p.id, p.tipo::text, p.proveedor::text, p.estado::text, p.monto::float8, p.medio, p.comprobante_url, p.motivo_rechazo,
		       p.proveedor_payment_id, o.numero, p.order_id, c.nombre, p.customer_id, p.created_at, p.acreditado_at
		FROM payments p
		LEFT JOIN orders o ON o.id = p.order_id
		LEFT JOIN customers c ON c.id = p.customer_id
		WHERE ($1::text IS NULL OR p.estado::text = $1) AND ($2::timestamptz IS NULL OR p.created_at >= $2)
		ORDER BY p.created_at DESC LIMIT 300`, e, desde)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (PagoListado, error) {
		var p PagoListado
		err := r.Scan(&p.ID, &p.Tipo, &p.Proveedor, &p.Estado, &p.Monto, &p.Medio, &p.ComprobanteURL, &p.MotivoRechazo,
			&p.ProveedorPaymentID, &p.NumeroPedido, &p.OrderID, &p.Cliente, &p.CustomerID, &p.CreatedAt, &p.AcreditadoAt)
		if p.ComprobanteURL != nil {
			u := URLDelComprobante(p.ID)
			p.ComprobanteURL = &u
		}
		return p, err
	})
}

// ResumenPagos son los números de arriba de la conciliación.
type ResumenPagos struct {
	AcreditadoMes   float64 `json:"acreditadoMes"`
	CantidadMes     int     `json:"cantidadMes"`
	EnRevision      int     `json:"enRevision"`
	MontoEnRevision float64 `json:"montoEnRevision"`
	RechazadosMes   int     `json:"rechazadosMes"`
	EnVivo          bool    `json:"enVivo"`
	AvisosConError  int     `json:"avisosConError"`
}

// Resumen es resumenPagos: «en revisión» sin corte de fecha (es lo trabado
// ahora).
func (s *Servicio) Resumen(ctx context.Context, p reportes.Periodo) (ResumenPagos, error) {
	r := ResumenPagos{EnVivo: s.EnVivo()}
	err := s.pool.QueryRow(ctx, `
		SELECT coalesce(sum(monto) FILTER (WHERE estado = 'aprobado' AND ($1::timestamptz IS NULL OR acreditado_at >= $1)
		                                    AND ($2::timestamptz IS NULL OR acreditado_at < $2)), 0)::float8,
		       (count(*) FILTER (WHERE estado = 'aprobado' AND ($1::timestamptz IS NULL OR acreditado_at >= $1)
		                          AND ($2::timestamptz IS NULL OR acreditado_at < $2)))::int,
		       coalesce(sum(monto) FILTER (WHERE estado = 'en_revision'), 0)::float8,
		       (count(*) FILTER (WHERE estado = 'en_revision'))::int,
		       (count(*) FILTER (WHERE estado = 'rechazado' AND ($1::timestamptz IS NULL OR created_at >= $1)
		                          AND ($2::timestamptz IS NULL OR created_at < $2)))::int
		FROM payments`, p.Desde, p.Hasta).Scan(&r.AcreditadoMes, &r.CantidadMes, &r.MontoEnRevision, &r.EnRevision, &r.RechazadosMes)
	if err != nil {
		return r, err
	}
	err = s.pool.QueryRow(ctx, `
		SELECT count(*)::int FROM payment_events WHERE error IS NOT NULL
		  AND ($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at < $2)`, p.Desde, p.Hasta).
		Scan(&r.AvisosConError)
	return r, err
}

// AvisoListado es un aviso recibido.
type AvisoListado struct {
	ID          string     `json:"id"`
	Proveedor   string     `json:"proveedor"`
	EventoID    string     `json:"eventoId"`
	Tipo        *string    `json:"tipo"`
	FirmaValida *string    `json:"firmaValida"`
	Error       *string    `json:"error"`
	ProcesadoAt *time.Time `json:"procesadoAt"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// Avisos son los últimos avisos.
func (s *Servicio) Avisos(ctx context.Context, limite int) ([]AvisoListado, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT id, proveedor::text, evento_id, tipo, firma_valida, error, procesado_at, created_at
		FROM payment_events ORDER BY created_at DESC LIMIT $1`, limite)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (AvisoListado, error) {
		var a AvisoListado
		return a, r.Scan(&a.ID, &a.Proveedor, &a.EventoID, &a.Tipo, &a.FirmaValida, &a.Error, &a.ProcesadoAt, &a.CreatedAt)
	})
}
