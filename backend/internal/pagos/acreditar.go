// Package pagos son los cobros online y las transferencias: abrir el pago
// de un pedido o de una inscripción (Mercado Pago o el de demostración),
// el webhook en la misma dirección de siempre, acreditar, la conciliación del
// panel y lo que el cliente informa (comprobantes y cheques). Era lib/pagos,
// lib/dal/pagos.ts, lib/dal/admin/pagos.ts, app/(public)/pago-actions.ts,
// app/(public)/pago-demo y app/admin/pagos (tanda 6).
//
// **Acreditar es la única función que mueve plata** y tiene que poder
// llegar dos veces (el webhook y la vuelta del usuario, o los reintentos de
// Mercado Pago) y acreditar una sola: el mismo candado que el TS
// (pg_advisory_xact_lock(hashtext(pagoId))) y la comparación contra el
// estado que ya tiene la fila.
package pagos

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/cobros"
	"mjbj/internal/cola"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// TipoResultado es el trabajo de la cola que avisa un pago acreditado: lo
// atiende el worker (internal/notificaciones: el correo, el aviso al panel,
// el recibo, el de una inscripción).
const TipoResultado = "pago.resultado"

// TipoAviso es el aviso de Mercado Pago encolado por el webhook: lo atiende
// el worker de Go.
const TipoAviso = "pago.aviso"

// Servicio son los cobros.
type Servicio struct {
	pool  *pgxpool.Pool
	cfg   Config
	log   *slog.Logger
	ahora func() time.Time
	// SinCandado apaga el candado de acreditar (solo para ver fallar la
	// prueba de concurrencia).
	SinCandado bool
	// Proveedor reemplaza al que elige la configuración (pruebas).
	Proveedor func(nombre string) Proveedor
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, cfg Config, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, cfg: cfg, log: log, ahora: time.Now}
}

func (s *Servicio) elegido() Proveedor { return s.cfg.Elegir() }

func (s *Servicio) porNombre(n string) Proveedor {
	if s.Proveedor != nil {
		return s.Proveedor(n)
	}
	return s.cfg.PorNombre(n)
}

// EnVivo: los cobros salen de verdad (no es el de demostración).
func (s *Servicio) EnVivo() bool { return s.elegido().Real() }

func fallo(m string) error { return plataforma.NuevoProblema(http.StatusUnprocessableEntity, m) }

// ResultadoAcreditacion es lo que devuelve Acreditar.
type ResultadoAcreditacion struct {
	Cambio     bool    `json:"cambio"`
	Estado     string  `json:"estado"`
	OrderID    *string `json:"orderId"`
	CustomerID *string `json:"customerId"`
	Tipo       string  `json:"tipo"`
	Monto      float64 `json:"monto"`
	Motivo     *string `json:"motivo,omitempty"`
	ReceiptID  *string `json:"receiptId"`
	// Trabajo es el aviso encolado para el TS, si se acreditó.
	Trabajo *string `json:"trabajo,omitempty"`
}

type filaDePago struct {
	id, tipo, proveedor, estado string
	orderID, customerID, medio  *string
	monto                       jsmath.Num
	movimiento                  *string
	acreditadoAt                *time.Time
}

func texto(s string) *string { return &s }

// Acreditar es acreditarPago.
func (s *Servicio) Acreditar(ctx context.Context, pagoID string, r *PagoRemoto) (ResultadoAcreditacion, error) {
	var res ResultadoAcreditacion
	if !plataforma.UUIDValido(pagoID) {
		return ResultadoAcreditacion{Estado: "desconocido", Tipo: "pedido", Motivo: texto("El aviso no corresponde a ningún cobro nuestro.")}, nil
	}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		res = ResultadoAcreditacion{}
		if !s.SinCandado {
			if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1::text))`, pagoID); err != nil {
				return err
			}
		}
		var p filaDePago
		err := tx.QueryRow(ctx, `
			SELECT id, tipo::text, proveedor::text, estado::text, order_id, customer_id, medio, monto, account_movement_id, acreditado_at
			FROM payments WHERE id = $1`, pagoID).
			Scan(&p.id, &p.tipo, &p.proveedor, &p.estado, &p.orderID, &p.customerID, &p.medio, &p.monto, &p.movimiento, &p.acreditadoAt)
		if errors.Is(err, pgx.ErrNoRows) {
			res = ResultadoAcreditacion{Estado: "desconocido", Tipo: "pedido", Motivo: texto("El aviso no corresponde a ningún cobro nuestro.")}
			return nil
		}
		if err != nil {
			return err
		}
		nuestro := float64(p.monto)
		res = ResultadoAcreditacion{Estado: p.estado, OrderID: p.orderID, CustomerID: p.customerID, Tipo: p.tipo, Monto: nuestro}

		// Lo que ya se devolvió en reintegros parciales.
		var yaDevuelto float64
		if err := tx.QueryRow(ctx, `SELECT coalesce(sum(importe), 0)::float8 FROM payment_refunds WHERE payment_id = $1`, p.id).
			Scan(&yaDevuelto); err != nil {
			return err
		}
		// Un reintegro parcial deja el pago aprobado (Decidir lo vería
		// «igual»): se devuelve la parte nueva, una sola vez.
		if falta := ReintegroParcial(p.estado, nuestro, r, yaDevuelto); falta > 0 {
			acumulado := float64(yaDevuelto + falta)
			if err := reintegrarTramo(ctx, tx, p, r.ID, falta, acumulado, "Reintegro parcial del pago online"); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE payments SET detalle = $2, updated_at = now() WHERE id = $1`, pagoID, crudo(r)); err != nil {
				return err
			}
			res.Cambio = true
			return nil
		}

		decision, motivo := Decidir(p.estado, nuestro, r.Estado, r.Monto)
		switch decision {
		case Igual, Ignorar:
			return nil
		case Revision:
			if _, err := tx.Exec(ctx, `
				UPDATE payments SET estado = 'en_revision', proveedor_payment_id = $2, medio = $3, detalle = $4, motivo_rechazo = $5,
				       updated_at = now() WHERE id = $1`, pagoID, r.ID, r.Medio, crudo(r), motivo); err != nil {
				return err
			}
			res.Cambio, res.Estado, res.Motivo = true, "en_revision", &motivo
			return nil
		}

		acredita := r.Estado == Aprobado
		revierte := r.Estado == Reintegrado && p.estado == Aprobado
		movimiento := p.movimiento

		if acredita && p.tipo == "deuda" && p.customerID != nil {
			// El pago de una deuda deja su recibo: EmitirRecibo escribe el
			// movimiento de la cuenta.
			transferencia := p.proveedor == "transferencia"
			origen, medio := "mercado_pago", cobros.Medio("mercado_pago")
			var ref *string
			if transferencia {
				origen, medio = "portal", "transferencia"
				if p.medio != nil && *p.medio == "deposito" {
					medio = "deposito"
				}
			} else {
				ref = &r.ID
			}
			id := p.id
			recibo, err := cobros.EmitirRecibo(ctx, tx, cobros.Cobro{
				CustomerID: p.customerID, Origen: origen, Concepto: texto("Pago de cuenta corriente"),
				Partes: []cobros.Parte{{Medio: medio, Importe: nuestro, PaymentID: &id, Referencia: ref}},
			})
			if err != nil {
				return err
			}
			movimiento = recibo.AccountMovementID
			res.ReceiptID = &recibo.ReceiptID
		}
		if acredita && p.tipo == "inscripcion" {
			if _, err := tx.Exec(ctx, `UPDATE event_registrations SET estado = 'confirmada', updated_at = now() WHERE payment_id = $1`, p.id); err != nil {
				return err
			}
		}
		if revierte && p.tipo == "inscripcion" {
			if _, err := tx.Exec(ctx, `UPDATE event_registrations SET estado = 'cancelada', updated_at = now() WHERE payment_id = $1`, p.id); err != nil {
				return err
			}
		}
		if revierte && p.tipo == "deuda" && p.customerID != nil {
			// La deuda vuelve: se anula el recibo (o, de antes de los recibos,
			// un ajuste suelto). Un asiento no se borra.
			//
			// Si alguien ya anuló el recibo a mano, la deuda ya volvió: el
			// reintegro está hecho. Antes AnularRecibo fallaba con «ya estaba
			// anulado» y el aviso se reintentaba para siempre, con el pago
			// aprobado en la base y reintegrado en Mercado Pago.
			var recibo, estadoRecibo string
			err := tx.QueryRow(ctx, `SELECT p.receipt_id, r.estado::text FROM receipt_parts p JOIN receipts r ON r.id = p.receipt_id
				WHERE p.payment_id = $1 LIMIT 1`, p.id).Scan(&recibo, &estadoRecibo)
			switch {
			case err == nil && estadoRecibo == string(sqlc.EstadoReciboAnulado):
			case (err == nil || errors.Is(err, pgx.ErrNoRows)) && yaDevuelto > 0:
				// Ya hubo reintegros parciales: el recibo no se anula (volvería
				// la deuda entera y lo parcial quedaría devuelto dos veces); se
				// devuelve lo que faltaba, como un tramo más.
				if falta := float64(nuestro - yaDevuelto); falta >= 0.01 {
					if err := reintegrarTramo(ctx, tx, p, r.ID, falta, nuestro, "Reintegro del pago online"); err != nil {
						return err
					}
				}
			case err == nil:
				if _, _, err := cobros.AnularRecibo(ctx, tx, recibo, "Reintegro del pago online", nil); err != nil {
					return err
				}
			case errors.Is(err, pgx.ErrNoRows):
				if _, err := tx.Exec(ctx, `
					INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia)
					VALUES ($1, 'ajuste', $2::numeric, 'Reintegro de un pago online', $3)`, *p.customerID, jsmath.Fijo2(nuestro), r.ID); err != nil {
					return err
				}
			default:
				return err
			}
		}
		medio := r.Medio
		if p.proveedor == "transferencia" {
			medio = p.medio
		}
		acreditado := p.acreditadoAt
		if acredita {
			ahora := s.ahora()
			acreditado = &ahora
		}
		if _, err := tx.Exec(ctx, `
			UPDATE payments SET estado = $2::estado_cobro, proveedor_payment_id = $3, medio = $4, detalle = $5, motivo_rechazo = $6,
			       account_movement_id = $7, acreditado_at = $8, updated_at = now()
			WHERE id = $1`, pagoID, r.Estado, r.ID, medio, crudo(r), r.MotivoRechazo, movimiento, acreditado); err != nil {
			return err
		}
		if p.orderID != nil && (acredita || revierte) {
			estado := "pagado"
			if !acredita {
				estado = "reintegrado"
			}
			if _, err := tx.Exec(ctx, `UPDATE orders SET estado_pago = $2::estado_pago, updated_at = now() WHERE id = $1`, *p.orderID, estado); err != nil {
				return err
			}
		}
		if p.orderID != nil && r.Estado == Rechazado {
			if _, err := tx.Exec(ctx, `UPDATE orders SET estado_pago = 'rechazado', updated_at = now() WHERE id = $1`, *p.orderID); err != nil {
				return err
			}
		}
		// Un pago que llega aprobado y ya con una parte devuelta (el aviso de
		// la aprobación se perdió): se acredita y se devuelve esa parte.
		if falta := ReintegroParcial(Aprobado, nuestro, r, yaDevuelto); acredita && falta > 0 {
			if err := reintegrarTramo(ctx, tx, p, r.ID, falta, float64(yaDevuelto+falta), "Reintegro parcial del pago online"); err != nil {
				return err
			}
		}
		res.Cambio, res.Estado = true, r.Estado
		if acredita {
			// El aviso al cliente y al panel, en la misma transacción: si el
			// pago se acredita, el aviso queda encolado; si no, tampoco.
			id, err := cola.Encolar(ctx, sqlc.New(tx), TipoResultado, map[string]any{
				"orderId": p.orderID, "customerId": p.customerID, "tipo": p.tipo, "detalle": "aprobado", "receiptId": res.ReceiptID,
			}, time.Time{})
			if err != nil {
				return err
			}
			res.Trabajo = &id
		}
		return nil
	})
	return res, err
}

// reintegrarTramo anota un tramo devuelto de un pago (payment_refunds) y, si
// el pago canceló deuda, la devuelve a la cuenta del cliente con un ajuste
// con la referencia del pago de Mercado Pago. Si el recibo ya se había
// anulado a mano, la deuda entera ya volvió: el tramo se anota sin tocar la
// cuenta. El índice único sobre (pago, acumulado) frena un segundo tramo
// igual aunque faltara el candado.
//
// El pago de un pedido no tiene deuda que devolver: Mercado Pago le devuelve
// la plata a la tarjeta del cliente, y el tramo queda anotado para el
// cierre.
func reintegrarTramo(ctx context.Context, tx pgx.Tx, p filaDePago, remotoID string, importe, acumulado float64, detalle string) error {
	var tramo string
	err := tx.QueryRow(ctx, `
		INSERT INTO payment_refunds (payment_id, importe, acumulado, referencia) VALUES ($1, $2::numeric, $3::numeric, $4)
		ON CONFLICT (payment_id, acumulado) DO NOTHING RETURNING id`,
		p.id, jsmath.Fijo2(importe), jsmath.Fijo2(acumulado), remotoID).Scan(&tramo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if p.tipo != "deuda" || p.customerID == nil {
		return nil
	}
	var recibo *string
	var anulado bool
	err = tx.QueryRow(ctx, `SELECT r.id, r.estado = 'anulado' FROM receipt_parts x JOIN receipts r ON r.id = x.receipt_id
		WHERE x.payment_id = $1 LIMIT 1`, p.id).Scan(&recibo, &anulado)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if anulado {
		return nil
	}
	var mov string
	if err := tx.QueryRow(ctx, `
		INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, receipt_id)
		VALUES ($1, 'ajuste', $2::numeric, $3, $4, $5) RETURNING id`,
		*p.customerID, jsmath.Fijo2(importe), detalle, remotoID, recibo).Scan(&mov); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE payment_refunds SET account_movement_id = $2 WHERE id = $1`, tramo, mov)
	return err
}

func crudo(r *PagoRemoto) []byte {
	if len(r.Crudo) == 0 {
		return []byte("null")
	}
	return r.Crudo
}

// --- lib/pagos/webhook.ts ---

// ResultadoAviso es lo que pasó con un aviso.
type ResultadoAviso struct {
	Resultado  string  `json:"resultado"` // acreditado | actualizado | sin_cambios | repetido | ignorado | sin_firma | error
	Detalle    string  `json:"detalle,omitempty"`
	OrderID    *string `json:"orderId,omitempty"`
	CustomerID *string `json:"customerId,omitempty"`
	Tipo       string  `json:"tipo,omitempty"`
	Trabajo    *string `json:"trabajo,omitempty"`
}

// CargaAviso es el trabajo pago.aviso: lo que llegó al webhook.
type CargaAviso struct {
	Proveedor       string          `json:"proveedor"`
	Cuerpo          json.RawMessage `json:"cuerpo"`
	URL             string          `json:"url"`
	FirmaVerificada *bool           `json:"firmaVerificada"`
}

// ProcesarAviso es procesarAviso: el webhook (por la cola) y la pantalla de
// demostración pasan por acá. **No tira**: el problema queda en
// payment_events.error y vuelve como «error».
func (s *Servicio) ProcesarAviso(ctx context.Context, c CargaAviso) (ResultadoAviso, error) {
	prov := s.porNombre(c.Proveedor)
	if prov == nil {
		return ResultadoAviso{Resultado: "ignorado", Detalle: "Proveedor no configurado."}, nil
	}
	var cuerpo any
	_ = json.Unmarshal(c.Cuerpo, &cuerpo)
	var query map[string][]string
	if u, err := parsearURL(c.URL); err == nil {
		query = u
	}
	aviso := prov.InterpretarAviso(cuerpo, query)
	if aviso == nil || aviso.PagoRemotoID == "" {
		return ResultadoAviso{Resultado: "ignorado", Detalle: "El aviso no es sobre un pago."}, nil
	}
	// Con firma inválida no entra nada a la base: el registro del servidor
	// alcanza para rastrear una ráfaga.
	if c.FirmaVerificada != nil && !*c.FirmaVerificada {
		s.log.Warn("aviso de pago con firma inválida, descartado", "evento", aviso.EventoID)
		return ResultadoAviso{Resultado: "sin_firma"}, nil
	}
	proveedor := "mercado_pago"
	if c.Proveedor == "demo" {
		proveedor = "demo"
	}
	firma := "no_aplica"
	if c.FirmaVerificada != nil {
		firma = "true"
	}
	cuerpoGuardado := c.Cuerpo
	if len(cuerpoGuardado) == 0 || !json.Valid(cuerpoGuardado) {
		cuerpoGuardado = []byte("{}")
	}
	var evento string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO payment_events (proveedor, evento_id, tipo, cuerpo, firma_valida)
		VALUES ($1::proveedor_pago, $2, $3, $4, $5)
		ON CONFLICT DO NOTHING RETURNING id`, proveedor, aviso.EventoID, aviso.Tipo, cuerpoGuardado, firma).Scan(&evento)
	if errors.Is(err, pgx.ErrNoRows) {
		// Ya estaba: si la vez anterior terminó con error, se retoma (uno
		// solo: el UPDATE condicional es el candado).
		err = s.pool.QueryRow(ctx, `
			UPDATE payment_events SET procesado_at = NULL, error = NULL
			WHERE proveedor = $1::proveedor_pago AND evento_id = $2 AND procesado_at IS NOT NULL AND error IS NOT NULL
			RETURNING id`, proveedor, aviso.EventoID).Scan(&evento)
		if errors.Is(err, pgx.ErrNoRows) {
			return ResultadoAviso{Resultado: "repetido"}, nil
		}
	}
	if err != nil {
		return ResultadoAviso{}, err
	}
	marcar := func(msg *string) {
		if _, err := s.pool.Exec(context.WithoutCancel(ctx), `UPDATE payment_events SET procesado_at = now(), error = $2 WHERE id = $1`, evento, msg); err != nil {
			s.log.Error("no se pudo marcar el aviso", "evento", evento, "error", err)
		}
	}
	remoto, err := prov.ConsultarPago(ctx, aviso.PagoRemotoID)
	if err != nil {
		marcar(texto(err.Error()))
		s.log.Error("pagos.webhook", "evento", aviso.EventoID, "error", err)
		return ResultadoAviso{Resultado: "error", Detalle: err.Error()}, nil
	}
	if remoto == nil {
		marcar(texto("El proveedor no reconoce ese pago."))
		return ResultadoAviso{Resultado: "ignorado"}, nil
	}
	// Por nuestra referencia y, si no vino, por el id del proveedor.
	var pago string
	var ref *string
	if remoto.Referencia != nil && plataforma.UUIDValido(*remoto.Referencia) {
		ref = remoto.Referencia
	}
	err = s.pool.QueryRow(ctx, `
		SELECT id FROM payments WHERE ($1::uuid IS NOT NULL AND id = $1::uuid)
		   OR (proveedor_payment_id = $2 AND conciliado_at IS NULL) LIMIT 1`, ref, remoto.ID).Scan(&pago)
	if errors.Is(err, pgx.ErrNoRows) {
		marcar(texto("Sin cobro local para " + remoto.ID + "."))
		return ResultadoAviso{Resultado: "ignorado"}, nil
	}
	if err != nil {
		marcar(texto(err.Error()))
		return ResultadoAviso{Resultado: "error", Detalle: err.Error()}, nil
	}
	r, err := s.Acreditar(ctx, pago, remoto)
	if err != nil {
		marcar(texto(err.Error()))
		s.log.Error("pagos.webhook", "evento", aviso.EventoID, "error", err)
		return ResultadoAviso{Resultado: "error", Detalle: err.Error()}, nil
	}
	marcar(r.Motivo)
	out := ResultadoAviso{OrderID: r.OrderID, CustomerID: r.CustomerID, Tipo: r.Tipo, Trabajo: r.Trabajo}
	switch {
	case !r.Cambio:
		out.Resultado = "sin_cambios"
	case r.Estado == Aprobado:
		out.Resultado, out.Detalle = "acreditado", r.Estado
	default:
		out.Resultado, out.Detalle = "actualizado", r.Estado
	}
	return out, nil
}

// Manejador es el del trabajo pago.aviso en el worker: un «error» se
// reintenta (es lo que retoma el aviso).
func (s *Servicio) Manejador() cola.Manejador {
	return func(ctx context.Context, carga json.RawMessage) error {
		var c CargaAviso
		if err := json.Unmarshal(carga, &c); err != nil {
			return err
		}
		r, err := s.ProcesarAviso(ctx, c)
		if err != nil {
			return err
		}
		if r.Resultado == "error" {
			if r.Detalle == "" {
				r.Detalle = "El aviso de pago no se pudo procesar."
			}
			return errors.New(r.Detalle)
		}
		return nil
	}
}
