package cobros

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/cola"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas/fragmentos"
)

// ErrSinCaja es el cobro en efectivo sin turno abierto en la sucursal del
// pedido. Lleva la sucursal y su fondo de cambio para que la pantalla abra
// la caja ahí mismo con el fondo de siempre (abierta con $0 a las apuradas,
// el turno cerraba con una diferencia falsa). Un pedido sin sucursal (de la
// tienda, del bot) no sabe en qué caja entra: lleva las sucursales para
// elegir, las de caja abierta si hay, y si no todas.
type ErrSinCaja struct {
	Sucursal   string
	FondoBase  float64
	Sucursales []SucursalParaCobrar
}

// SucursalParaCobrar es una de las opciones de un pedido sin sucursal.
type SucursalParaCobrar struct {
	ID      string  `json:"id"`
	Nombre  string  `json:"nombre"`
	Abierta bool    `json:"abierta"`
	Fondo   float64 `json:"fondo"`
}

func (e *ErrSinCaja) Error() string {
	if e.Sucursal == "" && len(e.Sucursales) > 0 {
		return "Elegí en qué caja entra el efectivo."
	}
	return "Abrí la caja para cobrar en efectivo."
}

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
//   - Un pedido sin sucursal cobra el efectivo en la que se elige
//     (`sucursal`); sin elegir, en la única caja abierta.
func (s *Servicio) CobrarPedido(ctx context.Context, ses *auth.Sesion, pedido, partesCrudas, clave, sucursal string) (ResultadoDeCobro, error) {
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
			       greatest(`+fragmentos.ACobrarDelPedido+` - `+fragmentos.CobradoDelPedido+`, 0)::float8,
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
			donde := p.sucursal
			if donde == nil && plataforma.UUIDValido(sucursal) {
				donde = &sucursal
			}
			turno, err := turnoDelPedido(ctx, q, donde)
			if err != nil {
				return err
			}
			if turno == "" {
				return sinCaja(ctx, tx, donde)
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
		if err := tx.QueryRow(ctx, `SELECT `+fragmentos.CobradoDelPedido+` + 0.005 >= `+fragmentos.ACobrarDelPedido+` FROM orders o WHERE o.id = $1`, pedido).Scan(&pagado); err != nil {
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
			"Cobró "+numero+" con el recibo "+r.Numero+" por "+formato.Moneda(r.Total), map[string]any{"receiptId": r.ReceiptID})
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

// sinCaja arma el ErrSinCaja: con la sucursal y su fondo, o, sin sucursal,
// con las opciones para elegir.
func sinCaja(ctx context.Context, tx pgx.Tx, sucursal *string) error {
	if sucursal != nil {
		e := &ErrSinCaja{Sucursal: *sucursal}
		var fondo jsmath.Num
		if err := tx.QueryRow(ctx, `SELECT fondo_base FROM branches WHERE id::text = $1`, *sucursal).Scan(&fondo); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		e.FondoBase = fondo.F()
		return e
	}
	filas, err := tx.Query(ctx, `
		SELECT b.id::text, b.name, exists(SELECT 1 FROM cash_sessions cs WHERE cs.branch_id = b.id AND cs.estado = 'abierta'), b.fondo_base
		FROM branches b WHERE b.active ORDER BY b.sort_order, b.name`)
	if err != nil {
		return err
	}
	todas, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (SucursalParaCobrar, error) {
		var o SucursalParaCobrar
		var fondo jsmath.Num
		err := r.Scan(&o.ID, &o.Nombre, &o.Abierta, &fondo)
		o.Fondo = fondo.F()
		return o, err
	})
	if err != nil {
		return err
	}
	var abiertas []SucursalParaCobrar
	for _, o := range todas {
		if o.Abierta {
			abiertas = append(abiertas, o)
		}
	}
	if len(abiertas) > 0 {
		return &ErrSinCaja{Sucursales: abiertas}
	}
	return &ErrSinCaja{Sucursales: todas}
}
