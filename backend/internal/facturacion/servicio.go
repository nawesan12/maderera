// Package facturacion es la facturación electrónica con la base: el emisor y
// los puntos de venta, la emisión con la numeración sin huecos, el pedido de
// CAE a ARCA (fuera de la transacción), las notas de crédito y débito, el
// cobro de un comprobante, el libro IVA ventas, los comprobantes del portal y
// el PDF. Es lib/fiscal/emitir.ts, lib/dal/admin/facturacion.ts y
// app/admin/facturacion/actions.ts. Las cuentas están en internal/fiscal.
package facturacion

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/fiscal"
	"mjbj/internal/sqlc"
)

// Las claves de candado propias (las de la numeración son las del TS:
// fiscal.ClaveDeLock).
const (
	// CandadoCAE: un pedido de CAE a la vez. ARCA autoriza en orden (el
	// siguiente número de cada punto de venta y tipo) y no da otro ticket
	// mientras haya uno vigente: dos pedidos en paralelo se pisaban.
	CandadoCAE int64 = 1_000_000_003_001
	// CandadoTicket: pedir y guardar el ticket del WSAA.
	CandadoTicket int64 = 1_000_000_003_002
	// CandadoConfiguracion: crear la fila de configuración fiscal la primera
	// vez (dos pedidos a la vez creaban dos).
	CandadoConfiguracion int64 = 1_000_000_003_003
)

// Servicio son las acciones y lecturas de facturación.
type Servicio struct {
	pool  *pgxpool.Pool
	q     *sqlc.Queries
	log   *slog.Logger
	env   fiscal.Entorno
	ahora func() time.Time
	// cae ordena los pedidos de CAE dentro del proceso antes del candado de
	// la base: así los que esperan no tienen tomada una conexión del pool
	// (con veinte a la vez, el que tenía el candado no conseguía conexión
	// para seguir).
	cae *sync.Mutex

	// sinCandado saca el candado de la numeración (solo para ver fallar la
	// prueba de concurrencia).
	sinCandado bool
	// despuesDelCAE corre entre la respuesta de ARCA y el guardado del CAE
	// (las pruebas cortan el proceso ahí).
	despuesDelCAE func(invoiceID string) error
}

// Nuevo arma el servicio con el entorno del proceso.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), log: log, env: fiscal.DelProceso, ahora: time.Now, cae: &sync.Mutex{}}
}

// ConEntorno usa otras variables (las pruebas, el simulador).
func (s *Servicio) ConEntorno(e fiscal.Entorno) *Servicio {
	c := *s
	c.env = e
	return &c
}

// ErrNoEsta es un comprobante, pedido o punto de venta que no existe.
var ErrNoEsta = errors.New("no está")

// Emisor es la fila de configuracion_fiscal, como la devolvía drizzle.
type Emisor struct {
	ID                     string     `json:"id"`
	RazonSocial            string     `json:"razonSocial"`
	NombreFantasia         *string    `json:"nombreFantasia"`
	Cuit                   *string    `json:"cuit"`
	CondicionIva           string     `json:"condicionIva"`
	Domicilio              *string    `json:"domicilio"`
	Localidad              string     `json:"localidad"`
	CodigoPostal           *string    `json:"codigoPostal"`
	Telefono               *string    `json:"telefono"`
	Email                  *string    `json:"email"`
	IngresosBrutos         *string    `json:"ingresosBrutos"`
	RegimenIibb            string     `json:"regimenIibb"`
	AlicuotaPercepcionIibb string     `json:"alicuotaPercepcionIibb"`
	PercibeIibb            bool       `json:"percibeIibb"`
	InicioActividades      *time.Time `json:"inicioActividades"`
	Leyenda                *string    `json:"leyenda"`
	UpdatedAt              time.Time  `json:"updatedAt"`
}

const columnasEmisor = `id, razon_social, nombre_fantasia, cuit, condicion_iva::text, domicilio, localidad, codigo_postal, telefono,
	email, ingresos_brutos, regimen_iibb::text, alicuota_percepcion_iibb::text, percibe_iibb, inicio_actividades, leyenda, updated_at`

func (e *Emisor) campos() []any {
	return []any{&e.ID, &e.RazonSocial, &e.NombreFantasia, &e.Cuit, &e.CondicionIva, &e.Domicilio, &e.Localidad, &e.CodigoPostal,
		&e.Telefono, &e.Email, &e.IngresosBrutos, &e.RegimenIibb, &e.AlicuotaPercepcionIibb, &e.PercibeIibb, &e.InicioActividades,
		&e.Leyenda, &e.UpdatedAt}
}

// emisorEn lee el emisor dentro de una transacción (creándolo si falta): la
// emisión no puede pedir otra conexión del pool mientras tiene la suya, o
// con muchas a la vez se queda esperando una conexión que nunca se libera.
func emisorEn(ctx context.Context, tx pgx.Tx) (*Emisor, error) {
	var e Emisor
	err := tx.QueryRow(ctx, `SELECT `+columnasEmisor+` FROM configuracion_fiscal LIMIT 1`).Scan(e.campos()...)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, CandadoConfiguracion); err != nil {
			return nil, err
		}
		err = tx.QueryRow(ctx, `SELECT `+columnasEmisor+` FROM configuracion_fiscal LIMIT 1`).Scan(e.campos()...)
		if errors.Is(err, pgx.ErrNoRows) {
			err = tx.QueryRow(ctx, `INSERT INTO configuracion_fiscal DEFAULT VALUES RETURNING `+columnasEmisor).Scan(e.campos()...)
		}
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// consultor es lo que tienen el pool y una transacción.
type consultor interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// ObtenerEmisor es obtenerConfiguracionFiscal: la fila, creándola con los
// valores por defecto la primera vez.
func (s *Servicio) ObtenerEmisor(ctx context.Context) (*Emisor, error) {
	var e Emisor
	err := s.pool.QueryRow(ctx, `SELECT `+columnasEmisor+` FROM configuracion_fiscal LIMIT 1`).Scan(e.campos()...)
	if err == nil {
		return &e, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, CandadoConfiguracion); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `SELECT `+columnasEmisor+` FROM configuracion_fiscal LIMIT 1`).Scan(e.campos()...)
		if errors.Is(err, pgx.ErrNoRows) {
			err = tx.QueryRow(ctx, `INSERT INTO configuracion_fiscal DEFAULT VALUES RETURNING `+columnasEmisor).Scan(e.campos()...)
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return &e, nil
}
