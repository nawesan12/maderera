package cobros

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/cola"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas/fragmentos"
)

// ErrSinCaja es el cobro en efectivo sin turno abierto en la sucursal del
// pedido. Lleva la sucursal para que la pantalla abra la caja ahí mismo.
type ErrSinCaja struct{ Sucursal string }

func (e *ErrSinCaja) Error() string { return "Abrí la caja para cobrar en efectivo." }

// CobrarPedido cobra un pedido desde su ficha (T3, hallazgo 5): **pasa por
// EmitirRecibo como cualquier cobro**. Reemplaza a «marcar cobrado», que
// cambiaba el estado sin recibo, sin registro de pago y sin pasar por la
// caja: el efectivo de un pedido entregado no entraba al arqueo y nadie
// podía decir con qué se había pagado.
//
//   - Sin cliente también: el recibo sale a nombre del contacto del pedido.
//   - No cobra más que el saldo (el total menos lo cobrado en línea y los
//     recibos vivos del pedido).
//   - El efectivo entra al turno abierto de la sucursal del pedido; sin
//     turno, no se cobra en efectivo. Una transferencia o Mercado Pago sin
//     caja abierta sí: esa plata ya está en el banco.
//   - «Pagado» sale de la suma de lo cobrado, no de un botón.
//   - La clave hace repetible el cobro.
func (s *Servicio) CobrarPedido(ctx context.Context, ses *auth.Sesion, pedido, partesCrudas, clave string) (ResultadoDeCobro, error) {
	if !plataforma.UUIDValido(pedido) {
		return ResultadoDeCobro{}, plataforma.NuevoProblema(404, "No se encontró el pedido.")
	}
	partes, e := LeerPartes(partesCrudas)
	if e != "" {
		return ResultadoDeCobro{}, plataforma.Invalido(map[string]string{"partes": e})
	}
	if ConRetencion(partes) {
		return ResultadoDeCobro{}, plataforma.Invalido(map[string]string{"partes": "Una retención se carga desde la cuenta del cliente, con su certificado."})
	}
	var r ReciboEmitido
	var numero string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		var p struct {
			numero, contacto, estado string
			cliente, sucursal        *string
			saldo                    float64
			fuera                    bool
		}
		err := tx.QueryRow(ctx, `
			SELECT o.numero, o.contacto_nombre, o.estado::text, o.customer_id, o.branch_id,
			       greatest(o.total - `+fragmentos.CobradoDelPedido+`, 0)::float8,
			       o.medio_pago IS DISTINCT FROM 'cuenta_corriente'
			         AND NOT EXISTS (SELECT 1 FROM account_movements am
			                         WHERE am.customer_id = o.customer_id AND am.referencia = o.numero AND am.tipo = 'compra')
			FROM orders o WHERE o.id = $1 FOR UPDATE`, pedido).
			Scan(&p.numero, &p.contacto, &p.estado, &p.cliente, &p.sucursal, &p.saldo, &p.fuera)
		if errors.Is(err, pgx.ErrNoRows) {
			return plataforma.NuevoProblema(404, "No se encontró el pedido.")
		}
		if err != nil {
			return err
		}
		numero = p.numero
		if p.estado == "cancelado" {
			return errCobro("El pedido está cancelado.")
		}
		// Un reintento con la misma clave pasa antes del tope: el saldo ya
		// incluye ese recibo.
		total := TotalDePartes(importes(partes))
		var yaEsta bool
		if clave != "" {
			if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM receipts WHERE clave = $1)`, clave).Scan(&yaEsta); err != nil {
				return err
			}
		}
		if !yaEsta {
			if p.saldo < 0.005 {
				return errCobro(p.numero + " ya está cobrado.")
			}
			if total > p.saldo+0.005 {
				return errCobro("A " + p.numero + " le faltan " + jsmath.Fijo2(p.saldo) + ": no se puede cobrar más que eso.")
			}
		}
		var c *Caja
		if hayEfectivo(partes) {
			turno, err := turnoDelPedido(ctx, q, p.sucursal)
			if err != nil {
				return err
			}
			if turno == "" {
				suc := ""
				if p.sucursal != nil {
					suc = *p.sucursal
				}
				return &ErrSinCaja{Sucursal: suc}
			}
			c = &Caja{TurnoID: turno}
		}
		concepto := "Cobro del pedido " + p.numero
		cobro := Cobro{CustomerID: p.cliente, RecibidoDe: p.contacto, BranchID: p.sucursal, Origen: "panel", Concepto: &concepto,
			Partes: partes, Caja: c, UsuarioID: &ses.UserID, OrderID: &pedido, Clave: clave,
			// La deuda de un pedido de contado no está en la cuenta: el pago
			// tampoco.
			FueraDeLaCuenta: p.fuera}
		if p.cliente != nil {
			// Con cliente, el recibo va a su nombre (la razón social).
			cobro.RecibidoDe = ""
		}
		if r, err = EmitirRecibo(ctx, tx, cobro); err != nil {
			return err
		}
		if r.Repetido {
			return nil
		}
		var pagado bool
		if err := tx.QueryRow(ctx, `SELECT `+fragmentos.CobradoDelPedido+` + 0.005 >= o.total FROM orders o WHERE o.id = $1`, pedido).Scan(&pagado); err != nil {
			return err
		}
		if pagado {
			if err := q.PedidoPagado(ctx, pedido); err != nil {
				return err
			}
		}
		if p.cliente != nil {
			_, err = cola.Encolar(ctx, q, TrabajoAvisoDeRecibo, map[string]string{"receiptId": r.ReceiptID}, time.Time{})
		}
		return err
	})
	if err != nil {
		return ResultadoDeCobro{}, comoProblema(err)
	}
	if !r.Repetido {
		bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCobrar, "pedido", pedido,
			"Cobró "+numero+" con el recibo "+r.Numero+" por "+jsmath.Fijo2(r.Total), map[string]any{"receiptId": r.ReceiptID})
	}
	return ResultadoDeCobro{Ok: "Recibo " + r.Numero + " emitido.", Aviso: r.Aviso, ReceiptID: &r.ReceiptID}, nil
}

func hayEfectivo(partes []Parte) bool {
	for _, p := range partes {
		if p.Medio == "efectivo" {
			return true
		}
	}
	return false
}

// turnoDelPedido es el turno abierto de la sucursal del pedido. Un pedido
// sin sucursal (de la tienda) cae en la única caja abierta; con varias, no
// se sabe a cuál y se cobra desde el mostrador.
func turnoDelPedido(ctx context.Context, q *sqlc.Queries, sucursal *string) (string, error) {
	turnos, err := q.CajasAbiertas(ctx)
	if err != nil {
		return "", err
	}
	for _, t := range turnos {
		if sucursal != nil && t.BranchID == *sucursal {
			return t.ID, nil
		}
	}
	if sucursal == nil && len(turnos) == 1 {
		return turnos[0].ID, nil
	}
	return "", nil
}
