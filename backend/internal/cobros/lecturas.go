package cobros

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNoEsta es un recibo o una ficha que no existe.
var ErrNoEsta = errors.New("no está")

// ChequeListado es una fila de la cartera de cheques (lib/dal/admin/cheques.ts).
type ChequeListado struct {
	ID            string    `json:"id"`
	Sentido       string    `json:"sentido"`
	Tipo          string    `json:"tipo"`
	Numero        string    `json:"numero"`
	Banco         *string   `json:"banco"`
	Librador      *string   `json:"librador"`
	FechaPago     time.Time `json:"fechaPago"`
	Importe       float64   `json:"importe"`
	Estado        string    `json:"estado"`
	Cliente       *string   `json:"cliente"`
	CustomerID    *string   `json:"customerId"`
	Circuito      string    `json:"circuito"`
	Proveedor     *string   `json:"proveedor"`
	Notas         *string   `json:"notas"`
	ReceiptID     *string   `json:"receiptId"`
	Recibo        *string   `json:"recibo"`
	MotivoRechazo *string   `json:"motivoRechazo"`
}

// Cheques es listarCheques: los vivos primero (por fecha de pago), después
// el resto.
func Cheques(ctx context.Context, pool *pgxpool.Pool, estado, sentido string) ([]ChequeListado, error) {
	if estado == "todos" {
		estado = ""
	}
	if sentido == "todos" {
		sentido = ""
	}
	filas, err := pool.Query(ctx, `
		SELECT ch.id, ch.sentido::text, ch.tipo::text, ch.numero, ch.banco, ch.librador, ch.fecha_pago, ch.importe::float8,
		  ch.estado::text, cu.nombre, ch.customer_id, ch.circuito::text, su.nombre, ch.notas, ch.receipt_id, r.numero, ch.motivo_rechazo
		FROM cheques ch
		LEFT JOIN customers cu ON cu.id = ch.customer_id
		LEFT JOIN supplier_payment_parts spp ON spp.cheque_id = ch.id
		LEFT JOIN supplier_payments sp ON sp.id = spp.payment_id
		LEFT JOIN suppliers su ON su.id = sp.supplier_id
		LEFT JOIN receipts r ON r.id = ch.receipt_id
		WHERE ($1 = '' OR ch.estado::text = $1) AND ($2 = '' OR ch.sentido::text = $2)
		ORDER BY CASE WHEN ch.estado IN ('informado', 'cartera', 'depositado', 'entregado') THEN 0 ELSE 1 END,
		  ch.fecha_pago, ch.created_at DESC`, estado, sentido)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (ChequeListado, error) {
		var c ChequeListado
		return c, r.Scan(&c.ID, &c.Sentido, &c.Tipo, &c.Numero, &c.Banco, &c.Librador, &c.FechaPago, &c.Importe, &c.Estado,
			&c.Cliente, &c.CustomerID, &c.Circuito, &c.Proveedor, &c.Notas, &c.ReceiptID, &c.Recibo, &c.MotivoRechazo)
	})
}

// ChequeEnCartera es uno recibido que se puede entregar a un proveedor.
type ChequeEnCartera struct {
	ID        string    `json:"id"`
	Numero    string    `json:"numero"`
	Banco     *string   `json:"banco"`
	FechaPago time.Time `json:"fechaPago"`
	Importe   float64   `json:"importe"`
	Tipo      string    `json:"tipo"`
	Cliente   *string   `json:"cliente"`
}

// EnCartera es chequesEnCartera.
func EnCartera(ctx context.Context, pool *pgxpool.Pool) ([]ChequeEnCartera, error) {
	filas, err := pool.Query(ctx, `
		SELECT ch.id, ch.numero, ch.banco, ch.fecha_pago, ch.importe::float8, ch.tipo::text, cu.nombre
		FROM cheques ch LEFT JOIN customers cu ON cu.id = ch.customer_id
		WHERE ch.estado = 'cartera' AND ch.sentido = 'recibido'
		ORDER BY ch.fecha_pago`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (ChequeEnCartera, error) {
		var c ChequeEnCartera
		return c, r.Scan(&c.ID, &c.Numero, &c.Banco, &c.FechaPago, &c.Importe, &c.Tipo, &c.Cliente)
	})
}

// MovimientoDelResumen es un renglón del resumen de cuenta, con el saldo
// corrido.
type MovimientoDelResumen struct {
	ID         string    `json:"id"`
	Fecha      time.Time `json:"fecha"`
	Tipo       string    `json:"tipo"`
	Detalle    *string   `json:"detalle"`
	Referencia *string   `json:"referencia"`
	ReceiptID  *string   `json:"receiptId"`
	Monto      float64   `json:"monto"`
	Saldo      float64   `json:"saldo"`
}

// ClienteDelResumen es el encabezado del resumen.
type ClienteDelResumen struct {
	ID            string  `json:"id"`
	Nombre        string  `json:"nombre"`
	RazonSocial   *string `json:"razonSocial"`
	Cuit          *string `json:"cuit"`
	Direccion     *string `json:"direccion"`
	LimiteCredito float64 `json:"limiteCredito"`
}

// ResumenDeCuenta es resumenDeCuenta: todos los movimientos del más viejo al
// más nuevo, con el saldo después de cada uno, y el aging.
type ResumenDeCuenta struct {
	Cliente     ClienteDelResumen      `json:"cliente"`
	Movimientos []MovimientoDelResumen `json:"movimientos"`
	Saldo       float64                `json:"saldo"`
	Aging       Aging                  `json:"aging"`
}

func redondear2(v float64) float64 { return math.Floor(v*100+0.5) / 100 }

// Resumen es resumenDeCuenta; ErrNoEsta si no hay ficha.
func Resumen(ctx context.Context, pool *pgxpool.Pool, cliente string, hoy time.Time) (*ResumenDeCuenta, error) {
	var r ResumenDeCuenta
	err := pool.QueryRow(ctx, `SELECT id, nombre, razon_social, cuit, direccion, limite_credito::float8 FROM customers WHERE id = $1`, cliente).
		Scan(&r.Cliente.ID, &r.Cliente.Nombre, &r.Cliente.RazonSocial, &r.Cliente.Cuit, &r.Cliente.Direccion, &r.Cliente.LimiteCredito)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	filas, err := pool.Query(ctx, `SELECT id, created_at, tipo::text, detalle, referencia, receipt_id, monto::float8
		FROM account_movements WHERE customer_id = $1 ORDER BY created_at`, cliente)
	if err != nil {
		return nil, err
	}
	acumulado := 0.0
	r.Movimientos, err = pgx.CollectRows(filas, func(f pgx.CollectableRow) (MovimientoDelResumen, error) {
		var m MovimientoDelResumen
		err := f.Scan(&m.ID, &m.Fecha, &m.Tipo, &m.Detalle, &m.Referencia, &m.ReceiptID, &m.Monto)
		acumulado += m.Monto
		m.Saldo = redondear2(acumulado)
		return m, err
	})
	if err != nil {
		return nil, err
	}
	movs := make([]Movimiento, len(r.Movimientos))
	for i, m := range r.Movimientos {
		movs[i] = Movimiento{m.Monto, m.Fecha}
	}
	r.Saldo = redondear2(acumulado)
	r.Aging = CalcularAging(movs, hoy)
	return &r, nil
}

// CuentaCorriente es miCuentaCorriente del portal: los movimientos del más
// nuevo al más viejo, con el saldo después de cada uno (sin redondear, como
// el TS), y lo disponible del límite.
type CuentaCorriente struct {
	Saldo         float64                `json:"saldo"`
	LimiteCredito float64                `json:"limiteCredito"`
	Disponible    float64                `json:"disponible"`
	Movimientos   []MovimientoDelResumen `json:"movimientos"`
}

// DelCliente es la cuenta corriente para el portal.
func DelCliente(ctx context.Context, pool *pgxpool.Pool, cliente string, limite float64) (CuentaCorriente, error) {
	c := CuentaCorriente{LimiteCredito: limite, Movimientos: []MovimientoDelResumen{}}
	filas, err := pool.Query(ctx, `SELECT id, created_at, tipo::text, detalle, referencia, receipt_id, monto::float8
		FROM account_movements WHERE customer_id = $1 ORDER BY created_at`, cliente)
	if err != nil {
		return c, err
	}
	movs, err := pgx.CollectRows(filas, func(f pgx.CollectableRow) (MovimientoDelResumen, error) {
		var m MovimientoDelResumen
		err := f.Scan(&m.ID, &m.Fecha, &m.Tipo, &m.Detalle, &m.Referencia, &m.ReceiptID, &m.Monto)
		c.Saldo += m.Monto
		m.Saldo = c.Saldo
		return m, err
	})
	if err != nil {
		return c, err
	}
	for i := len(movs) - 1; i >= 0; i-- {
		c.Movimientos = append(c.Movimientos, movs[i])
	}
	c.Disponible = math.Max(limite-c.Saldo, 0)
	return c, nil
}

// ParteDelRecibo es un medio del recibo, con su cheque si lo es.
type ParteDelRecibo struct {
	Medio      string       `json:"medio"`
	Importe    float64      `json:"importe"`
	Referencia *string      `json:"referencia"`
	Cheque     *ChequeParte `json:"cheque"`
}

// ChequeParte es el cheque de una parte.
type ChequeParte struct {
	ID        string    `json:"id"`
	Tipo      string    `json:"tipo"`
	Numero    string    `json:"numero"`
	Banco     *string   `json:"banco"`
	Librador  *string   `json:"librador"`
	FechaPago time.Time `json:"fechaPago"`
	Estado    string    `json:"estado"`
}

// ClienteDelRecibo es a quién se le emitió.
type ClienteDelRecibo struct {
	ID        string  `json:"id"`
	Cuit      *string `json:"cuit"`
	Direccion *string `json:"direccion"`
}

// ReciboCompleto es lo que necesitan el PDF y los avisos (lib/dal/recibos.ts).
type ReciboCompleto struct {
	ID              string            `json:"id"`
	Numero          string            `json:"numero"`
	Fecha           time.Time         `json:"fecha"`
	Estado          string            `json:"estado"`
	Origen          string            `json:"origen"`
	Concepto        *string           `json:"concepto"`
	Total           float64           `json:"total"`
	RecibidoDe      string            `json:"recibidoDe"`
	MotivoAnulacion *string           `json:"motivoAnulacion"`
	AnuladoAt       *time.Time        `json:"anuladoAt"`
	Cliente         *ClienteDelRecibo `json:"cliente"`
	Partes          []ParteDelRecibo  `json:"partes"`
	SaldoDespues    *float64          `json:"saldoDespues"`
	EmitidoPor      *string           `json:"emitidoPor"`
}

// Recibo es reciboCompleto; ErrNoEsta si no hay. El saldo después es el de
// la cuenta hasta el movimiento del recibo, incluido.
func Recibo(ctx context.Context, pool *pgxpool.Pool, id string) (*ReciboCompleto, error) {
	var r ReciboCompleto
	var cliente, cuit, direccion, movimiento *string
	err := pool.QueryRow(ctx, `
		SELECT r.id, r.numero, r.created_at, r.estado::text, r.origen::text, r.concepto, r.total::float8, r.recibido_de,
		  r.motivo_anulacion, r.anulado_at, r.customer_id, r.account_movement_id, c.cuit, c.direccion, u.name
		FROM receipts r LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN "user" u ON u.id = r.created_by_user_id
		WHERE r.id = $1`, id).Scan(&r.ID, &r.Numero, &r.Fecha, &r.Estado, &r.Origen, &r.Concepto, &r.Total, &r.RecibidoDe,
		&r.MotivoAnulacion, &r.AnuladoAt, &cliente, &movimiento, &cuit, &direccion, &r.EmitidoPor)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	if cliente != nil {
		r.Cliente = &ClienteDelRecibo{*cliente, cuit, direccion}
	}
	filas, err := pool.Query(ctx, `
		SELECT p.medio::text, p.importe::float8, p.referencia, ch.id, ch.tipo::text, ch.numero, ch.banco, ch.librador, ch.fecha_pago, ch.estado::text
		FROM receipt_parts p LEFT JOIN cheques ch ON ch.id = p.cheque_id
		WHERE p.receipt_id = $1 ORDER BY p.orden`, id)
	if err != nil {
		return nil, err
	}
	r.Partes, err = pgx.CollectRows(filas, func(f pgx.CollectableRow) (ParteDelRecibo, error) {
		var p ParteDelRecibo
		var chID, tipo, numero, estado *string
		var fecha *time.Time
		var banco, librador *string
		err := f.Scan(&p.Medio, &p.Importe, &p.Referencia, &chID, &tipo, &numero, &banco, &librador, &fecha, &estado)
		if err == nil && chID != nil {
			p.Cheque = &ChequeParte{*chID, deref(tipo), deref(numero), banco, librador, *fecha, deref(estado)}
		}
		return p, err
	})
	if err != nil {
		return nil, err
	}
	if cliente != nil && movimiento != nil {
		var s float64
		if err := pool.QueryRow(ctx, `SELECT coalesce(sum(monto), 0)::float8 FROM account_movements
			WHERE customer_id = $1 AND created_at <= (SELECT created_at FROM account_movements WHERE id = $2)`, *cliente, *movimiento).Scan(&s); err != nil {
			return nil, err
		}
		r.SaldoDespues = &s
	}
	return &r, nil
}

// DuenoDelRecibo es clienteDelRecibo: el cliente (nil si se emitió sin
// ficha); ErrNoEsta si no hay recibo.
func DuenoDelRecibo(ctx context.Context, pool *pgxpool.Pool, id string) (*string, error) {
	var c *string
	err := pool.QueryRow(ctx, `SELECT customer_id FROM receipts WHERE id = $1`, id).Scan(&c)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	return c, err
}
