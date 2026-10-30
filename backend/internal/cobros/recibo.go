package cobros

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/sqlc"
)

// ErrorDeCobro es un motivo que se puede mostrar tal cual. EmitirRecibo corre
// dentro de la transacción de quien cobra: si algo no cierra, devuelve esto,
// la transacción vuelve atrás entera y la pantalla recibe un motivo en
// castellano y no un error de Postgres.
type ErrorDeCobro struct{ Mensaje string }

func (e *ErrorDeCobro) Error() string { return e.Mensaje }

func errCobro(m string) error { return &ErrorDeCobro{m} }

// Caja es a qué caja entra el efectivo: un turno, «buscar» (la única abierta
// o la de la sucursal) o ninguna.
type Caja struct {
	TurnoID string
	Buscar  bool
}

// Cobro es lo que se cobra (Cobro del TS).
type Cobro struct {
	CustomerID *string
	RecibidoDe string
	BranchID   *string
	Origen     string // panel | mostrador | portal | mercado_pago | factura
	Concepto   *string
	Partes     []Parte
	Circuito   string // blanco | negro
	Caja       *Caja
	UsuarioID  *string
}

// ReciboEmitido es lo que devuelve EmitirRecibo.
type ReciboEmitido struct {
	ReceiptID         string  `json:"receiptId"`
	Numero            string  `json:"numero"`
	Total             float64 `json:"total"`
	AccountMovementID *string `json:"accountMovementId"`
	// Algo que hay que decirle a quien cobró, aunque salió bien.
	Aviso *string `json:"aviso"`
}

// EmitirRecibo registra un cobro y emite su recibo. **Es la única forma de
// registrar un pago de un cliente** (lib/cobros/recibo.ts). En la
// transacción de quien llama:
//
//  1. numera el recibo (REC-0001, con el candado de la serie);
//  2. crea los cheques que vienen con el cobro, o ata los que ya existían;
//  3. deja **un** movimiento de cuenta corriente por el total;
//  4. si hay efectivo y se pidió, lo entra a la caja.
func EmitirRecibo(ctx context.Context, tx pgx.Tx, c Cobro) (ReciboEmitido, error) {
	q := sqlc.New(tx)
	if p := Revisar(c.Partes, c.Circuito); p != "" {
		return ReciboEmitido{}, errCobro(p)
	}
	total := TotalDePartes(importes(c.Partes))

	recibidoDe := strings.TrimSpace(c.RecibidoDe)
	if c.CustomerID != nil && recibidoDe == "" {
		cl, err := q.NombreDelCliente(ctx, *c.CustomerID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ReciboEmitido{}, errCobro("No se encontró el cliente.")
		}
		if err != nil {
			return ReciboEmitido{}, err
		}
		recibidoDe = cl.Nombre
		if cl.RazonSocial != nil && *cl.RazonSocial != "" {
			recibidoDe = *cl.RazonSocial
		}
	}
	if recibidoDe == "" {
		recibidoDe = "Consumidor final"
	}

	numero, err := numeracion.Recibo(ctx, tx)
	if err != nil {
		return ReciboEmitido{}, err
	}
	id, err := q.CrearRecibo(ctx, sqlc.CrearReciboParams{
		Numero: numero, CustomerID: c.CustomerID, RecibidoDe: recibidoDe, BranchID: c.BranchID,
		Total: jsmath.Fijo2(total), Origen: sqlc.OrigenRecibo(c.Origen), Concepto: c.Concepto, CreatedByUserID: c.UsuarioID,
	})
	if err != nil {
		return ReciboEmitido{}, err
	}
	circuito := c.Circuito
	if circuito == "" {
		circuito = "blanco"
	}
	for orden, p := range c.Partes {
		var cheque *string
		if EsCheque(p.Medio) {
			ch, err := chequeDeLaParte(ctx, tx, p, id, c.CustomerID, circuito, c.UsuarioID)
			if err != nil {
				return ReciboEmitido{}, err
			}
			cheque = &ch
		}
		var ref *string
		if p.Referencia != nil {
			if r := strings.TrimSpace(*p.Referencia); r != "" {
				ref = &r
			}
		}
		if err := q.CrearParteDeRecibo(ctx, sqlc.CrearParteDeReciboParams{
			ReceiptID: id, Medio: sqlc.MedioDeCobro(p.Medio), Importe: jsmath.Fijo2(ACentavos(p.Importe)),
			ChequeID: cheque, PaymentID: p.PaymentID, Referencia: ref, Orden: int32(orden),
		}); err != nil {
			return ReciboEmitido{}, err
		}
	}

	// Un solo movimiento por recibo, por el total: el detalle de con qué pagó
	// está en el recibo.
	r := ReciboEmitido{ReceiptID: id, Numero: numero, Total: total}
	if c.CustomerID != nil {
		detalle := "Recibo " + numero
		if c.Concepto != nil && *c.Concepto != "" {
			detalle = *c.Concepto + " — recibo " + numero
		}
		mov, err := q.AsentarMovimiento(ctx, sqlc.AsentarMovimientoParams{
			CustomerID: *c.CustomerID, Tipo: sqlc.TipoMovimientoCuentaPago, Monto: jsmath.Fijo2(-total),
			Detalle: &detalle, Referencia: &numero, ReceiptID: &id, CreatedByUserID: c.UsuarioID,
		})
		if err != nil {
			return ReciboEmitido{}, err
		}
		r.AccountMovementID = &mov
		if err := q.AtarMovimientoAlRecibo(ctx, sqlc.AtarMovimientoAlReciboParams{ID: id, AccountMovementID: &mov}); err != nil {
			return ReciboEmitido{}, err
		}
	}

	var efectivo []float64
	for _, p := range c.Partes {
		if p.Medio == "efectivo" {
			efectivo = append(efectivo, p.Importe)
		}
	}
	if monto := TotalDePartes(efectivo); monto > 0 && c.Caja != nil {
		aviso, err := efectivoALaCaja(ctx, q, *c.Caja, c.BranchID, monto, "Recibo "+numero+" — "+recibidoDe, c.UsuarioID)
		if err != nil {
			return ReciboEmitido{}, err
		}
		r.Aviso = aviso
	}
	return r, nil
}

func chequeDeLaParte(ctx context.Context, tx pgx.Tx, p Parte, recibo string, cliente *string, circuito string, usuario *string) (string, error) {
	q := sqlc.New(tx)
	if p.ChequeID != nil {
		ex, err := q.ChequePorID(ctx, *p.ChequeID)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", errCobro("Ese cheque ya no está.")
		}
		if err != nil {
			return "", err
		}
		// Uno informado llega acá al aceptarlo; uno de la cartera, si se lo
		// vuelve a usar. Cualquier otro estado ya no es plata disponible.
		if ex.Estado != sqlc.EstadoChequeInformado && ex.Estado != sqlc.EstadoChequeCartera {
			return "", errCobro("Ese cheque ya no está en cartera.")
		}
		if math.Abs(float64(ex.Importe)-p.Importe) > 0.005 {
			return "", errCobro("El importe de la parte no coincide con el del cheque.")
		}
		return ex.ID, q.ChequeACartera(ctx, sqlc.ChequeACarteraParams{ID: ex.ID, ReceiptID: &recibo})
	}
	tipo := "fisico"
	if p.Medio == "echeq" {
		tipo = "echeq"
	}
	return RegistrarChequeRecibido(ctx, tx, ChequeRecibido{
		Tipo: tipo, Numero: p.Cheque.Numero, Banco: p.Cheque.Banco, Librador: p.Cheque.Librador,
		Emision: p.Cheque.Emision, FechaPago: p.Cheque.FechaPago, Importe: p.Importe, CustomerID: cliente,
		Circuito: circuito, ReceiptID: &recibo, UsuarioID: usuario,
	})
}

// ChequeRecibido es un cheque que entra a la cartera.
type ChequeRecibido struct {
	Tipo, Numero, Banco string
	Librador            *string
	Emision             *time.Time
	FechaPago           time.Time
	Importe             float64
	CustomerID          *string
	Circuito            string
	ReceiptID           *string
	OrderPaymentID      *string
	UsuarioID           *string
}

// RegistrarChequeRecibido lo crea, después de mirar que no esté ya: el
// índice único también lo frena, pero daría un error de Postgres y esto da
// un motivo que dice qué cheque es. Lo usan el recibo y la venta del
// mostrador.
func RegistrarChequeRecibido(ctx context.Context, tx pgx.Tx, d ChequeRecibido) (string, error) {
	q := sqlc.New(tx)
	numero := NormalizarNumeroDeCheque(d.Numero)
	banco := strings.TrimSpace(d.Banco)
	if _, err := q.ChequeRepetido(ctx, sqlc.ChequeRepetidoParams{Numero: numero, Banco: banco}); err == nil {
		return "", errCobro(NombreDelCheque(d.Tipo, &banco, numero) + " ya está cargado. Buscalo en la cartera.")
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	var librador *string
	if d.Librador != nil {
		if l := strings.TrimSpace(*d.Librador); l != "" {
			librador = &l
		}
	}
	circuito := d.Circuito
	if circuito == "" {
		circuito = "blanco"
	}
	return q.CrearChequeRecibido(ctx, sqlc.CrearChequeRecibidoParams{
		Tipo: sqlc.TipoCheque(d.Tipo), Numero: numero, Banco: &banco, Librador: librador, Emision: d.Emision,
		FechaPago: d.FechaPago, Importe: jsmath.Fijo2(ACentavos(d.Importe)), CustomerID: d.CustomerID,
		Circuito: sqlc.Circuito(circuito), ReceiptID: d.ReceiptID, OrderPaymentID: d.OrderPaymentID, CreatedByUserID: d.UsuarioID,
	})
}

// efectivoALaCaja entra el efectivo del cobro al turno de caja. Si no se
// puede decidir a cuál, el cobro sale igual y se devuelve el aviso.
func efectivoALaCaja(ctx context.Context, q *sqlc.Queries, c Caja, sucursal *string, monto float64, motivo string, usuario *string) (*string, error) {
	turno := c.TurnoID
	if turno == "" {
		turnos, err := q.CajasAbiertas(ctx)
		if err != nil {
			return nil, err
		}
		for _, t := range turnos {
			if sucursal != nil && t.BranchID == *sucursal {
				turno = t.ID
				break
			}
		}
		if turno == "" && len(turnos) == 1 {
			turno = turnos[0].ID
		}
		if turno == "" {
			aviso := "Hay varias cajas abiertas y no se pudo saber a cuál entra el efectivo: registralo a mano desde el mostrador."
			if len(turnos) == 0 {
				aviso = "No hay ninguna caja abierta, así que el efectivo no entró al arqueo."
			}
			return &aviso, nil
		}
	}
	return nil, q.EfectivoACaja(ctx, sqlc.EfectivoACajaParams{SessionID: turno, Monto: jsmath.Fijo2(monto), Motivo: &motivo, CreadoPor: usuario})
}

// AnularRecibo lo marca anulado (no se borra: el cliente tiene el papel),
// revierte el pago en la cuenta y anula sus cheques que siguen en cartera.
// El efectivo que entró a la caja no se saca solo: lo resuelve quien cuenta
// la caja.
func AnularRecibo(ctx context.Context, tx pgx.Tx, recibo, motivo string, usuario *string) (numero string, cliente *string, err error) {
	q := sqlc.New(tx)
	if err := q.BloquearRecibo(ctx, recibo); err != nil {
		return "", nil, err
	}
	r, err := q.ReciboPorID(ctx, recibo)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, errCobro("Ese recibo no está.")
	}
	if err != nil {
		return "", nil, err
	}
	if r.Estado == sqlc.EstadoReciboAnulado {
		return "", nil, errCobro("Ese recibo ya estaba anulado.")
	}
	cheques, err := q.ChequesDelRecibo(ctx, recibo)
	if err != nil {
		return "", nil, err
	}
	for _, ch := range cheques {
		if ch == nil {
			continue
		}
		estado, err := q.EstadoDeCheque(ctx, *ch)
		if err == nil && estado != sqlc.EstadoChequeCartera {
			return "", nil, errCobro("Un cheque de este recibo ya salió de la cartera: si el banco lo rechaza, se marca desde la cartera de cheques y la deuda vuelve sola.")
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", nil, err
		}
		if err := q.AnularCheque(ctx, *ch); err != nil {
			return "", nil, err
		}
	}
	var anulacion *string
	if r.CustomerID != nil {
		// Lo que ya volvió a la cuenta por reintegros parciales de Mercado
		// Pago de este recibo no se devuelve otra vez: la deuda vuelve por el
		// total menos esos tramos.
		var devuelto float64
		if err := tx.QueryRow(ctx, `SELECT coalesce(sum(f.importe), 0)::float8 FROM payment_refunds f
			WHERE f.account_movement_id IS NOT NULL
			  AND f.payment_id IN (SELECT payment_id FROM receipt_parts WHERE receipt_id = $1 AND payment_id IS NOT NULL)`, recibo).Scan(&devuelto); err != nil {
			return "", nil, err
		}
		detalle := "Anulación del recibo " + r.Numero + ": " + motivo
		mov, err := q.AsentarMovimiento(ctx, sqlc.AsentarMovimientoParams{
			CustomerID: *r.CustomerID, Tipo: sqlc.TipoMovimientoCuentaAjuste, Monto: jsmath.Fijo2(jsmath.Redondear2(float64(r.Total) - devuelto)),
			Detalle: &detalle, Referencia: &r.Numero, ReceiptID: &recibo, CreatedByUserID: usuario,
		})
		if err != nil {
			return "", nil, err
		}
		anulacion = &mov
	}
	if err := q.MarcarReciboAnulado(ctx, sqlc.MarcarReciboAnuladoParams{ID: recibo, MotivoAnulacion: &motivo,
		AnuladoPorUserID: usuario, AnulacionMovementID: anulacion}); err != nil {
		return "", nil, err
	}
	// La retención que cargó este recibo deja de ser crédito fiscal (y el
	// certificado, corregido, se puede volver a cargar).
	if _, err := tx.Exec(ctx, `UPDATE retenciones_sufridas SET anulada_at = now() WHERE receipt_id = $1 AND anulada_at IS NULL`, recibo); err != nil {
		return "", nil, err
	}
	return r.Numero, r.CustomerID, nil
}
