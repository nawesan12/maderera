package facturacion

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
)

// ErrorDeEmision es un motivo de negocio que se muestra tal cual (el
// `{ error }` que devolvían las funciones de emitir.ts). Dentro de una
// transacción, devolverlo la deshace entera.
type ErrorDeEmision struct{ Mensaje string }

func (e *ErrorDeEmision) Error() string { return e.Mensaje }

func errEmision(m string) error { return &ErrorDeEmision{m} }

// Mensaje saca el motivo de un ErrorDeEmision, o "" si es otra cosa.
func Mensaje(err error) string {
	var e *ErrorDeEmision
	if errors.As(err, &e) {
		return e.Mensaje
	}
	return ""
}

// Linea es un renglón a emitir (LineaAEmitir).
type Linea struct {
	fiscal.LineaEntrada
	// En una nota parcial: qué renglón del original corrige.
	ItemOrigenID *string `json:"itemOrigenId,omitempty"`
}

// DatosEmision es DatosEmision de emitir.ts.
type DatosEmision struct {
	CustomerID           *string          `json:"customerId"`
	OrderID              *string          `json:"orderId"`
	ReceptorNombre       string           `json:"receptorNombre"`
	ReceptorCuit         *string          `json:"receptorCuit"`
	ReceptorCondicionIva string           `json:"receptorCondicionIva"`
	ReceptorDomicilio    *string          `json:"receptorDomicilio"`
	Lineas               []Linea          `json:"lineas"`
	PuntoVentaID         *string          `json:"puntoVentaId"`
	FechaVencimiento     *time.Time       `json:"fechaVencimiento"`
	Observaciones        *string          `json:"observaciones"`
	CreatedByUserID      *string          `json:"createdByUserId"`
	ComprobanteOrigenID  *string          `json:"comprobanteOrigenId"`
	TributosDados        []fiscal.Tributo `json:"tributosDados"`
}

type punto struct {
	id     string
	numero int64
}

// resolverPuntoVenta: el pedido, o el primero activo por número.
func resolverPuntoVenta(ctx context.Context, c consultor, id *string) (*punto, error) {
	var p punto
	if id != nil && plataforma.UUIDValido(*id) {
		err := c.QueryRow(ctx, `SELECT id, numero FROM puntos_venta WHERE id = $1`, *id).Scan(&p.id, &p.numero)
		if err == nil {
			return &p, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	err := c.QueryRow(ctx, `SELECT id, numero FROM puntos_venta WHERE activo ORDER BY numero LIMIT 1`).Scan(&p.id, &p.numero)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

// siguienteNumero es siguienteNumeroComprobante: con el candado del punto de
// venta y el tipo (la misma clave del TS), el mayor entre el máximo emitido y
// el piso del sistema anterior, más uno. Dentro de la transacción que crea el
// comprobante: si algo falla, el número no se quema.
func (s *Servicio) siguienteNumero(ctx context.Context, tx pgx.Tx, puntoVenta int64, tipo string) (int64, error) {
	if !s.sinCandado {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, fiscal.ClaveDeLock(puntoVenta, tipo)); err != nil {
			return 0, err
		}
	}
	var maximo, piso int64
	if err := tx.QueryRow(ctx, `SELECT coalesce(max(numero), 0)::bigint FROM invoices WHERE punto_venta = $1 AND tipo = $2::tipo_comprobante`,
		puntoVenta, tipo).Scan(&maximo); err != nil {
		return 0, err
	}
	err := tx.QueryRow(ctx, `SELECT numero_inicial FROM puntos_venta WHERE numero = $1 LIMIT 1`, puntoVenta).Scan(&piso)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	return max(maximo, piso) + 1, nil
}

// EmitirEnTransaccion es emitirEnTransaccion: decide la letra (o usa la
// forzada, en las notas), calcula los importes, toma el número y guarda el
// comprobante en estado «emitida». El CAE va después y por separado.
func (s *Servicio) EmitirEnTransaccion(ctx context.Context, tx pgx.Tx, d DatosEmision, tipoForzado string) (string, error) {
	if len(d.Lineas) == 0 {
		return "", errEmision("El comprobante no tiene ningún renglón cargado.")
	}
	config, err := emisorEn(ctx, tx)
	if err != nil {
		return "", err
	}
	if config.Cuit == nil || *config.Cuit == "" {
		return "", errEmision("Falta cargar el CUIT de la empresa antes de poder facturar. Se configura en ARCA › Datos del emisor.")
	}
	p, err := resolverPuntoVenta(ctx, tx, d.PuntoVentaID)
	if err != nil {
		return "", err
	}
	if p == nil {
		return "", errEmision("No hay ningún punto de venta cargado. Se configura en ARCA › Puntos de venta.")
	}
	tipo := tipoForzado
	if tipo == "" {
		tipo = fiscal.TipoFactura(fiscal.LetraQueCorresponde(config.CondicionIva, d.ReceptorCondicionIva))
	}
	entradas := make([]fiscal.LineaEntrada, len(d.Lineas))
	for i, l := range d.Lineas {
		entradas[i] = l.LineaEntrada
	}
	im := fiscal.Importes(entradas, d.TributosDados, config.PercibeIibb, jsmath.Numero(config.AlicuotaPercepcionIibb))

	numero, err := s.siguienteNumero(ctx, tx, p.numero, tipo)
	if err != nil {
		return "", err
	}
	var id string
	f := jsmath.Fijo2
	if err := tx.QueryRow(ctx, `INSERT INTO invoices (tipo, punto_venta_id, punto_venta, numero, estado, customer_id, order_id,
		receptor_nombre, receptor_cuit, receptor_condicion_iva, receptor_domicilio, neto, iva21, iva105, iva27, exento, tributos, total,
		comprobante_origen_id, fecha_vencimiento, observaciones, created_by_user_id)
		VALUES ($1::tipo_comprobante, $2, $3, $4, 'emitida', $5, $6, $7, $8, $9::condicion_iva, $10, $11::numeric, $12::numeric,
		$13::numeric, $14::numeric, $15::numeric, $16::numeric, $17::numeric, $18, $19, $20, $21) RETURNING id`,
		tipo, p.id, p.numero, numero, d.CustomerID, d.OrderID, d.ReceptorNombre, d.ReceptorCuit, d.ReceptorCondicionIva,
		d.ReceptorDomicilio, f(im.Totales.Neto), f(im.Iva21), f(im.Iva105), f(im.Iva27), f(im.Totales.Exento), f(im.TotalTributos),
		f(im.Total), d.ComprobanteOrigenID, d.FechaVencimiento, d.Observaciones, d.CreatedByUserID).Scan(&id); err != nil {
		return "", err
	}
	lote := &pgx.Batch{}
	for i, l := range im.Totales.Lineas {
		lote.Queue(`INSERT INTO invoice_items (invoice_id, descripcion, unidad, cantidad, precio_unitario, alicuota_iva, neto, iva, subtotal,
			invoice_item_origen_id, orden) VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10, $11)`,
			id, l.Descripcion, l.Unidad, f(l.Cantidad), jsmath.ToFixed(l.PrecioUnitarioNeto, 4), f(l.Alicuota), f(l.Neto), f(l.Iva),
			f(l.Subtotal), d.Lineas[i].ItemOrigenID, i)
	}
	for _, t := range im.Tributos {
		lote.Queue(`INSERT INTO invoice_tributos (invoice_id, codigo, descripcion, base_imponible, alicuota, importe)
			VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric)`, id, t.Codigo, t.Descripcion, f(t.Base), f(t.Alicuota), f(t.Importe))
	}
	if err := tx.SendBatch(ctx, lote).Close(); err != nil {
		return "", err
	}
	return id, nil
}

// EmitirComprobante es emitirComprobante: en su propia transacción. Un fallo
// que no es de negocio sale como «No se pudo emitir el comprobante».
func (s *Servicio) EmitirComprobante(ctx context.Context, d DatosEmision) (string, error) {
	var id string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		id, err = s.EmitirEnTransaccion(ctx, tx, d, "")
		return err
	})
	return id, s.comoEmision(err, "fiscal.emitir", "No se pudo emitir el comprobante. Intentá de nuevo.")
}

// comoEmision deja pasar un ErrorDeEmision y cambia cualquier otro por el
// mensaje genérico (anotando el error de verdad).
func (s *Servicio) comoEmision(err error, scope, generico string) error {
	if err == nil || Mensaje(err) != "" {
		return err
	}
	s.log.Error("emisión", "scope", scope, "error", err)
	return errEmision(generico)
}
