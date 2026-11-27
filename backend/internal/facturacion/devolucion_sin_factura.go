package facturacion

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
)

// La plata de la devolución de un pedido **sin factura** (mes simulado 2,
// M2S2-022): el pedido cobrado y entregado sin facturar no tenía por dónde
// devolverse («la plata vuelve por la caja o el banco, no desde acá», y
// ninguna pantalla lo hacía). Es la misma regla que la devolución de la
// factura —la plata vuelve por donde entró, y no más de lo que entró por
// ahí— con las mismas cuentas (partesDeLaVenta) y los mismos tramos, así el
// cierre lo asienta igual. Lo que no hay es nota de crédito: no hubo
// comprobante que corregir.

// TopesSinFactura es cuánto puede volver por cada destino de un pedido.
type TopesSinFactura struct {
	Caja   float64 `json:"caja"`
	Afuera float64 `json:"afuera"`
}

// TopesDelPedido lee los topes de la caja y de «por afuera» del pedido.
func TopesDelPedido(ctx context.Context, c consultor, pedido string) (TopesSinFactura, error) {
	var medio *string
	var total float64
	if err := c.QueryRow(ctx, `SELECT medio_pago::text, total::float8 FROM orders WHERE id = $1`, pedido).Scan(&medio, &total); err != nil {
		return TopesSinFactura{}, err
	}
	t, err := partesDeLaVenta(ctx, c, pedido, medio, total)
	if err != nil {
		return TopesSinFactura{}, err
	}
	return TopesSinFactura{Caja: t.caja, Afuera: t.afuera}, nil
}

// PlataDeLaDevolucion es la salida de la plata ya controlada contra los
// topes, lista para moverse cuando exista la devolución.
type PlataDeLaDevolucion struct {
	pedido, destino, turno string
	total                  float64
	topes                  topesDeLaVenta
}

// PrepararPlata controla, **antes de insertar la devolución** (si no, los
// topes ya la cuentan como devuelta), que lo que sale por la caja o por
// afuera no pase lo que entró por ahí, y que haya caja abierta en la
// sucursal. Quien llama tiene la transacción y el candado del pedido; acá
// se bloquean sus recibos antes de medir, como en DevolucionParcial.
func PrepararPlata(ctx context.Context, tx pgx.Tx, pedido, destino string, total float64, sucursal *string) (*PlataDeLaDevolucion, error) {
	if err := bloquearRecibosDelPedido(ctx, tx, pedido); err != nil {
		return nil, err
	}
	var medio *string
	var totalPedido float64
	if err := tx.QueryRow(ctx, `SELECT medio_pago::text, total::float8 FROM orders WHERE id = $1`, pedido).Scan(&medio, &totalPedido); err != nil {
		return nil, err
	}
	topes, err := partesDeLaVenta(ctx, tx, pedido, medio, totalPedido)
	if err != nil {
		return nil, err
	}
	p := &PlataDeLaDevolucion{pedido: pedido, destino: destino, total: total, topes: topes}
	switch destino {
	case DevolverPorCaja:
		if total > topes.caja+0.005 {
			if topes.caja <= 0.005 {
				return nil, errEmision("Esta venta no se cobró en efectivo: la plata no sale de la caja.")
			}
			return nil, errEmision("De la caja sale hasta " + formato.Moneda(topes.caja) + ": lo que esta venta cobró en efectivo.")
		}
		if sucursal == nil {
			return nil, errEmision("El pedido no tiene sucursal: no se sabe de qué caja sale.")
		}
		// FOR SHARE: el cierre del turno espera a que la devolución confirme.
		err := tx.QueryRow(ctx, `SELECT id FROM cash_sessions WHERE branch_id = $1 AND estado = 'abierta' LIMIT 1 FOR SHARE`, *sucursal).Scan(&p.turno)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errEmision("No hay caja abierta en la sucursal del pedido.")
		}
		if err != nil {
			return nil, err
		}
	case DevolverPorAfuera:
		if total > topes.afuera+0.005 {
			if topes.afuera <= 0.005 {
				return nil, errEmision("Esta venta no se cobró con tarjeta, transferencia ni cheque.")
			}
			return nil, errEmision("Por afuera vuelve hasta " + formato.Moneda(topes.afuera) + ": lo que esta venta cobró con otros medios.")
		}
	default:
		return nil, errEmision("Elegí por dónde vuelve la plata.")
	}
	return p, nil
}

// Mover saca la plata de la devolución ya insertada: el movimiento de la
// caja, o los tramos de los cobros y los recibos por los que vuelve, con los
// que el cierre la asienta.
func (p *PlataDeLaDevolucion) Mover(ctx context.Context, tx pgx.Tx, devolucion, nombre, motivo, userID string) error {
	pedido, total, topes := p.pedido, p.total, p.topes
	switch p.destino {
	case DevolverPorCaja:
		var mov string
		if err := tx.QueryRow(ctx, `INSERT INTO cash_movements (session_id, tipo, monto, motivo, order_id, creado_por)
			VALUES ($1, 'devolucion', $2::numeric, $3, $4, $5) RETURNING id`,
			p.turno, jsmath.Fijo2(-total), nombre+": "+motivo, pedido, userID).Scan(&mov); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE devoluciones SET cash_movement_id = $2 WHERE id = $1`, devolucion, mov); err != nil {
			return err
		}
		falta, err := tramosDeLosPagos(ctx, tx, pedido, devolucion, total, nombre, true)
		if err != nil {
			return err
		}
		if falta > 0.005 {
			if falta, err = reintegrarDeLosRecibos(ctx, tx, pedido, devolucion, falta, true); err != nil {
				return err
			}
		}
		if falta > 0.005 {
			return errEmision("Los cobros en efectivo de esta venta no alcanzan para devolver " + formato.Moneda(total) + ": revisalos en Cobros.")
		}
	case DevolverPorAfuera:
		if !topes.conRecibos {
			falta, err := tramosDeLosPagos(ctx, tx, pedido, devolucion, total, nombre, false)
			if err != nil {
				return err
			}
			if falta > 0.005 {
				return errEmision("Los cobros de esta venta no alcanzan para devolver " + formato.Moneda(total) + ": revisalos en Cobros.")
			}
			return nil
		}
		aRecibos := jsmath.Redondear2(max(0, total-topes.enLinea))
		falta, err := reintegrarDeLosRecibos(ctx, tx, pedido, devolucion, aRecibos, false)
		if err != nil {
			return err
		}
		if falta > 0.005 {
			return errEmision("Los cobros de esta venta no alcanzan para devolver " + formato.Moneda(total) + ": revisalos en Cobros.")
		}
		if enLinea := jsmath.Redondear2(min(total, topes.enLinea)); enLinea > 0.005 {
			if aPagos := jsmath.Redondear2(enLinea - min(enLinea, topes.mercadoPago)); aPagos > 0.005 {
				if _, err := tramosDeLosPagos(ctx, tx, pedido, devolucion, aPagos, nombre, false); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
