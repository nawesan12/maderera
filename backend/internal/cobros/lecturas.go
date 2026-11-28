package cobros

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/reglas"
	"mjbj/internal/ventas/fragmentos"
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
	ProveedorID   *string   `json:"proveedorId"`
	Notas         *string   `json:"notas"`
	ReceiptID     *string   `json:"receiptId"`
	Recibo        *string   `json:"recibo"`
	MotivoRechazo *string   `json:"motivoRechazo"`
	// SaldoCliente es lo que debe el cliente hoy, solo en los informados:
	// aceptar uno de una cuenta ya saldada es cobrar de más (mes simulado,
	// H240).
	SaldoCliente *float64 `json:"saldoCliente"`
	// Cómo terminó un rechazado: no se aceptó (era informado, la cuenta no
	// cambió) o se le devolvió al cliente desde la cartera; si no, lo
	// rechazó el banco (M2S4-017, M2S3-088).
	NoAceptado bool `json:"noAceptado"`
	Devuelto   bool `json:"devuelto"`
	// EsperaCae es el cheque de una venta con su factura esperando el CAE:
	// la pantalla dice eso y no «Circuito B» (M2S1-061, M2S3-035).
	EsperaCae bool `json:"esperaCae"`
	// ClienteRazonSocial es la del cliente: el librador «RF Construcciones
	// SRL» del cliente Roberto Fernández (razón social RF Construcciones)
	// salía «De tercero» (mes 23, M3S3-043).
	ClienteRazonSocial *string `json:"clienteRazonSocial"`
}

// EstadosVivos son los cheques que todavía mueven plata; el resto terminó.
const EstadosVivos = `('informado', 'cartera', 'depositado', 'entregado')`

// columnasDeCheque: el proveedor es el del último pago que lo nombra y no
// se anuló (un cheque de un pago anulado vuelve a la cartera y puede salir
// en otro: un JOIN directo lo repetía una vez por pago). Uno recibido que
// volvió a la cartera por un pago anulado no fue entregado a nadie: su
// tarjeta seguía diciendo «entregado a V3 Placas Costa» (mes 23). El propio
// de un pago anulado conserva a quién iba.
var columnasDeCheque = `
		SELECT ch.id, ch.sentido::text, ch.tipo::text, ch.numero, ch.banco, ch.librador, ch.fecha_pago, ch.importe::float8,
		  ch.estado::text, cu.nombre, ch.customer_id, ` + fragmentos.CircuitoDelCheque("ch") + `, pr.nombre, pr.id, ch.notas, ch.receipt_id, r.numero, ch.motivo_rechazo,
		  CASE WHEN ch.estado = 'informado' AND ch.customer_id IS NOT NULL THEN
		    (SELECT coalesce(sum(m.monto), 0)::float8 FROM account_movements m WHERE m.customer_id = ch.customer_id) END,
		  ch.estado = 'rechazado' AND EXISTS (SELECT 1 FROM cheque_estados ce WHERE ce.cheque_id = ch.id AND ce.desde = 'informado' AND ce.hacia = 'rechazado'),
		  ch.estado = 'rechazado' AND EXISTS (SELECT 1 FROM cheque_estados ce WHERE ce.cheque_id = ch.id AND ce.desde = 'cartera' AND ce.hacia = 'rechazado'),
		  ch.order_payment_id IS NOT NULL AND ` + fragmentos.ChequeEsperaCAE("ch") + `, nullif(cu.razon_social, '')
		FROM cheques ch
		LEFT JOIN customers cu ON cu.id = ch.customer_id
		LEFT JOIN LATERAL (
		  SELECT su.id, su.nombre FROM supplier_payment_parts spp
		  JOIN supplier_payments sp ON sp.id = spp.payment_id JOIN suppliers su ON su.id = sp.supplier_id
		  WHERE spp.cheque_id = ch.id AND (sp.anulado_at IS NULL OR ch.sentido = 'entregado')
		  ORDER BY (sp.anulado_at IS NULL) DESC, sp.fecha DESC LIMIT 1) pr ON true
		LEFT JOIN receipts r ON r.id = ch.receipt_id`

func leerCheques(filas pgx.Rows) ([]ChequeListado, error) {
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (ChequeListado, error) {
		var c ChequeListado
		return c, r.Scan(&c.ID, &c.Sentido, &c.Tipo, &c.Numero, &c.Banco, &c.Librador, &c.FechaPago, &c.Importe, &c.Estado,
			&c.Cliente, &c.CustomerID, &c.Circuito, &c.Proveedor, &c.ProveedorID, &c.Notas, &c.ReceiptID, &c.Recibo, &c.MotivoRechazo, &c.SaldoCliente,
			&c.NoAceptado, &c.Devuelto, &c.EsperaCae, &c.ClienteRazonSocial)
	})
}

// Cheques es listarCheques: los vivos primero (por fecha de pago), después
// el resto. `estado` «vivos» trae solo los que todavía mueven plata (la
// pantalla pide los terminados aparte, de a páginas: ChequesTerminados).
func Cheques(ctx context.Context, pool *pgxpool.Pool, estado, sentido string) ([]ChequeListado, error) {
	if estado == "todos" {
		estado = ""
	}
	if sentido == "todos" {
		sentido = ""
	}
	filas, err := pool.Query(ctx, columnasDeCheque+`
		WHERE ($1 = '' OR ch.estado::text = $1 OR ($1 = 'vivos' AND ch.estado IN `+EstadosVivos+`))
		  AND ($2 = '' OR ch.sentido::text = $2)
		ORDER BY CASE WHEN ch.estado IN `+EstadosVivos+` THEN 0 ELSE 1 END,
		  ch.fecha_pago, ch.created_at DESC`, estado, sentido)
	if err != nil {
		return nil, err
	}
	return leerCheques(filas)
}

// ChequesTerminados son los acreditados, rechazados y anulados, lo último
// que cambió primero, de a `limite`, con cuántos hay. Antes salían todos,
// sin tope, debajo de la cartera: con los años, la pantalla eran miles.
func ChequesTerminados(ctx context.Context, pool *pgxpool.Pool, limite, desplazamiento int) ([]ChequeListado, int, error) {
	var total int
	if err := pool.QueryRow(ctx, `SELECT count(*)::int FROM cheques WHERE estado NOT IN `+EstadosVivos).Scan(&total); err != nil {
		return nil, 0, err
	}
	filas, err := pool.Query(ctx, columnasDeCheque+`
		WHERE ch.estado NOT IN `+EstadosVivos+`
		ORDER BY ch.updated_at DESC, ch.id
		LIMIT $1 OFFSET $2`, limite, desplazamiento)
	if err != nil {
		return nil, 0, err
	}
	out, err := leerCheques(filas)
	return out, total, err
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
	// Circuito es en el que está el valor (fragmentos.CircuitoDelCheque):
	// la pantalla de pagos solo ofrece endosar los del circuito del pago.
	Circuito string `json:"circuito"`
	// EsperaCae es el de una venta con su factura esperando el CAE, y
	// Trabado que la regla «endoso_espera_cae» no deja endosarlo hasta el
	// CAE (mes 23, M2S2-040): la pantalla lo muestra apagado, como los del
	// otro circuito.
	EsperaCae bool `json:"esperaCae"`
	Trabado   bool `json:"trabado"`
}

// EnCartera es chequesEnCartera.
func EnCartera(ctx context.Context, pool *pgxpool.Pool) ([]ChequeEnCartera, error) {
	alCae := reglas.Es(ctx, pool, reglas.EndosoEsperaCAE, "al_cae")
	filas, err := pool.Query(ctx, `
		SELECT ch.id, ch.numero, ch.banco, ch.fecha_pago, ch.importe::float8, ch.tipo::text, cu.nombre, `+fragmentos.CircuitoDelCheque("ch")+`,
		  ch.order_payment_id IS NOT NULL AND `+fragmentos.ChequeEsperaCAE("ch")+`
		FROM cheques ch LEFT JOIN customers cu ON cu.id = ch.customer_id
		WHERE ch.estado = 'cartera' AND ch.sentido = 'recibido'
		ORDER BY ch.fecha_pago`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (ChequeEnCartera, error) {
		var c ChequeEnCartera
		err := r.Scan(&c.ID, &c.Numero, &c.Banco, &c.FechaPago, &c.Importe, &c.Tipo, &c.Cliente, &c.Circuito, &c.EsperaCae)
		c.Trabado = c.EsperaCae && alCae
		return c, err
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
	// ReciboNumero es el número del recibo de ReceiptID: la referencia de
	// una nota de débito por un cheque rechazado es el número del cheque, y
	// el portal decía «Recibo 55500321» (H303).
	ReciboNumero *string `json:"reciboNumero,omitempty"`
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
		m.Detalle = DetalleParaElCliente(m.Detalle)
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
	filas, err := pool.Query(ctx, `SELECT m.id, m.created_at, m.tipo::text, m.detalle, m.referencia, m.receipt_id, m.monto::float8, r.numero
		FROM account_movements m LEFT JOIN receipts r ON r.id = m.receipt_id WHERE m.customer_id = $1 ORDER BY m.created_at`, cliente)
	if err != nil {
		return c, err
	}
	movs, err := pgx.CollectRows(filas, func(f pgx.CollectableRow) (MovimientoDelResumen, error) {
		var m MovimientoDelResumen
		err := f.Scan(&m.ID, &m.Fecha, &m.Tipo, &m.Detalle, &m.Referencia, &m.ReceiptID, &m.Monto, &m.ReciboNumero)
		m.Detalle = DetalleParaElCliente(m.Detalle)
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
