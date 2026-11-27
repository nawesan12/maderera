package facturacion

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/cobros"
	"mjbj/internal/cola"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/precios"
	"mjbj/internal/sqlc"
)

// medioDeFactura es MEDIO_DE_FACTURA: cómo se anota cada medio del recibo en
// los cobros de la factura (que tienen su propia lista, más corta).
var medioDeFactura = map[cobros.Medio]string{
	"efectivo": "efectivo", "transferencia": "transferencia", "deposito": "transferencia", "cheque": "cheque", "echeq": "cheque",
	"tarjeta_debito": "tarjeta", "tarjeta_credito": "tarjeta", "mercado_pago": "mercado_pago", "retencion": "transferencia",
}

// ResultadoDeCobro es el EstadoFactura del cobro.
type ResultadoDeCobro struct {
	Ok        string  `json:"ok"`
	ReceiptID *string `json:"receiptId,omitempty"`
}

// Cobrar es registrarCobro: pasar a cuenta corriente (venderle fiado, con el
// control de límite y mora) o cobrar con recibo por cobros.EmitirRecibo, la
// única puerta de la plata de un cliente.
func (s *Servicio) Cobrar(ctx context.Context, ses *auth.Sesion, id, modo, montoTexto, partesCrudas string) (ResultadoDeCobro, error) {
	var c struct {
		id, estado, tipo, receptor string
		pv, numero                 int64
		cliente, pedido, sucursal  *string
	}
	err := s.pool.QueryRow(ctx, `SELECT i.id, i.estado::text, i.tipo::text, i.receptor_nombre, i.punto_venta, i.numero, i.customer_id,
		i.order_id, o.branch_id FROM invoices i LEFT JOIN orders o ON o.id = i.order_id WHERE i.id = $1`, id).
		Scan(&c.id, &c.estado, &c.tipo, &c.receptor, &c.pv, &c.numero, &c.cliente, &c.pedido, &c.sucursal)
	if errors.Is(err, pgx.ErrNoRows) {
		return ResultadoDeCobro{}, errEmision("No encontramos el comprobante.")
	}
	if err != nil {
		return ResultadoDeCobro{}, err
	}
	if c.estado == "anulada" {
		return ResultadoDeCobro{}, errEmision("El comprobante está anulado.")
	}
	// Lo ya cobrado no se cobra otra vez: la venta del mostrador, el pedido
	// cobrado con un recibo o el que se debe en la cuenta corriente tienen
	// saldo cero (SaldoDeFactura). Antes la factura ofrecía cobrar el total
	// de nuevo (simulación del mes, H130).
	var saldo jsmath.Num
	var anulado, enCuenta bool
	if err := s.pool.QueryRow(ctx, `SELECT `+SaldoDeFactura+`, coalesce(o.estado = 'cancelado', false), `+EnCuentaDeFactura+`
		FROM invoices i LEFT JOIN (SELECT invoice_id, sum(monto) AS cobrado, sum(monto) FILTER (WHERE medio <> 'cuenta_corriente') AS cobrado_contado FROM invoice_payments WHERE invoice_id = $1 GROUP BY invoice_id) c
		  ON c.invoice_id = i.id
		LEFT JOIN orders o ON o.id = i.order_id WHERE i.id = $1`, c.id).Scan(&saldo, &anulado, &enCuenta); err != nil {
		return ResultadoDeCobro{}, err
	}
	if anulado {
		return ResultadoDeCobro{}, errEmision("La venta de esta factura se anuló: no hay nada que cobrar.")
	}
	if saldo.F() < 0.01 {
		return ResultadoDeCobro{}, errEmision("Esta factura ya está cobrada.")
	}
	et := etiqueta(c.tipo, c.pv, c.numero)

	if modo == "cuenta_corriente" {
		// La que ya se debe en la cuenta no se pasa otra vez: cargaba la
		// deuda dos veces (la ficha lo ofrecía igual, simulación del mes).
		if enCuenta {
			return ResultadoDeCobro{}, errEmision("Esta factura ya está en la cuenta corriente.")
		}
		monto := precios.ParsearImporte(montoTexto)
		if math.IsNaN(monto) || math.IsInf(monto, 0) || monto <= 0 {
			return ResultadoDeCobro{}, errEmision("El importe tiene que ser mayor a cero.")
		}
		if c.cliente == nil {
			return ResultadoDeCobro{}, errEmision("Este comprobante no tiene cliente: no hay cuenta a la que pasarlo.")
		}
		credito, err := cobros.Credito(ctx, s.q, *c.cliente, monto, s.ahora())
		if err != nil {
			return ResultadoDeCobro{}, err
		}
		if !credito.Puede {
			motivo := "No se puede cargar a cuenta corriente."
			if credito.Motivo != nil {
				motivo = *credito.Motivo
			}
			return ResultadoDeCobro{}, errEmision(motivo + " Cobralo de otra forma o revisá la ficha del cliente.")
		}
		if _, err := s.pool.Exec(ctx, `INSERT INTO invoice_payments (invoice_id, medio, monto, created_by_user_id)
			VALUES ($1, 'cuenta_corriente', $2::numeric, $3)`, c.id, jsmath.Fijo2(monto), ses.UserID); err != nil {
			return ResultadoDeCobro{}, err
		}
		bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCobrar, "factura", c.id,
			"Pasó "+formato.Importe(monto)+" de "+et+" a cuenta corriente", nil)
		return ResultadoDeCobro{Ok: "Pasado a cuenta corriente."}, nil
	}

	partes, e := cobros.LeerPartes(partesCrudas)
	if e != "" {
		return ResultadoDeCobro{}, errEmision(e)
	}
	var r cobros.ReciboEmitido
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		r, err = cobrarConRecibo(ctx, tx, ses, c.id, c.cliente, c.receptor, c.sucursal, et, partes)
		return err
	})
	if err != nil {
		var ec *cobros.ErrorDeCobro
		if errors.As(err, &ec) {
			return ResultadoDeCobro{}, errEmision(ec.Mensaje)
		}
		return ResultadoDeCobro{}, err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCobrar, "factura", c.id,
		"Registró el cobro de "+et+" ("+c.receptor+") con el recibo "+r.Numero+" por "+formato.Importe(r.Total), map[string]any{"receiptId": r.ReceiptID})
	ok := "Cobro registrado con el recibo " + r.Numero + "."
	if r.Aviso != nil && *r.Aviso != "" {
		ok += " " + *r.Aviso
	}
	return ResultadoDeCobro{Ok: ok, ReceiptID: &r.ReceiptID}, nil
}

// cobrarConRecibo es el cobro de una factura con recibo, en la transacción de
// quien llama: cobros.EmitirRecibo (la única puerta de la plata de un
// cliente, con el efectivo a la caja abierta), los cobros de la factura y el
// aviso al cliente. Lo usan el cobro desde la ficha y la factura manual de
// contado.
func cobrarConRecibo(ctx context.Context, tx pgx.Tx, ses *auth.Sesion, factura string, cliente *string, receptor string,
	sucursal *string, et string, partes []cobros.Parte) (cobros.ReciboEmitido, error) {
	concepto := "Cobro de " + et
	r, err := cobros.EmitirRecibo(ctx, tx, cobros.Cobro{CustomerID: cliente, RecibidoDe: receptor, BranchID: sucursal,
		Origen: "factura", Concepto: &concepto, Partes: partes, Caja: &cobros.Caja{Buscar: true}, UsuarioID: &ses.UserID})
	if err != nil {
		return r, err
	}
	lote := &pgx.Batch{}
	for _, p := range partes {
		ref := p.Referencia
		if p.Cheque != nil {
			x := p.Cheque.Banco + " N° " + p.Cheque.Numero
			ref = &x
		}
		lote.Queue(`INSERT INTO invoice_payments (invoice_id, medio, monto, referencia, receipt_id, created_by_user_id)
			VALUES ($1, $2::medio_cobro, $3::numeric, $4, $5, $6)`, factura, medioDeFactura[p.Medio], jsmath.Fijo2(p.Importe), ref,
			r.ReceiptID, ses.UserID)
	}
	if err := tx.SendBatch(ctx, lote).Close(); err != nil {
		return r, err
	}
	// El reparto entre los circuitos se vuelve a fijar ahora que el recibo
	// está atado a la factura que cobra: sin cliente, la cuenta sale de ella;
	// con cliente, lo que cobra de una factura que espera el CAE va a
	// Anticipos atado a esa factura (cobros.RepartoDeRecibo), y no a cancelar
	// otra deuda abierta (mes simulado, M2S4-002).
	if _, err := cobros.FijarReparto(ctx, tx, r.ReceiptID); err != nil {
		return r, err
	}
	// El aviso al cliente sale solo si el cobro se confirma.
	_, err = cola.Encolar(ctx, sqlc.New(tx), cobros.TrabajoAvisoDeRecibo, map[string]string{"receiptId": r.ReceiptID}, time.Time{})
	return r, err
}
