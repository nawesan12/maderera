package mostrador

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/reservas"
	"mjbj/internal/ventas"
	"mjbj/internal/zodjs"
)

// ResultadoAnulacion es anularVentaDeMostrador: el motivo si no se pudo, y
// la factura que quedó esperando su nota de crédito.
type ResultadoAnulacion struct {
	Ok               bool
	Error            string
	FacturaPendiente *string
	Numero           string
}

// Anular es anularVentaDeMostrador: **nada se borra, todo se revierte.** El
// pedido queda cancelado, el stock vuelve con un movimiento de devolución
// (o se libera la reserva del acopio), la caja recibe un movimiento negativo,
// la deuda se cancela con otro asiento, los cheques en cartera se anulan y el
// corte que no se cortó se cae. El comprobante fiscal no se toca: se avisa.
//
// Todo lo que puede rechazar va antes de la primera escritura.
func (s *Servicio) Anular(ctx context.Context, pedido, motivo, usuario string) (ResultadoAnulacion, error) {
	motivo = zodjs.TrimJS(motivo)
	if motivo == "" {
		return ResultadoAnulacion{Error: "Poné el motivo: una anulación sin explicación no se puede revisar después."}, nil
	}
	var r ResultadoAnulacion
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		r, err = anularEnTransaccion(ctx, tx, pedido, motivo, usuario)
		if err == nil && !r.Ok {
			return errSinEscribir
		}
		return err
	})
	if errors.Is(err, errSinEscribir) {
		return r, nil
	}
	return r, err
}

func anularEnTransaccion(ctx context.Context, tx pgx.Tx, id, motivo, usuario string) (ResultadoAnulacion, error) {
	// El candado es por pedido: dos toques no revierten dos veces.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1::text))`, id); err != nil {
		return ResultadoAnulacion{}, err
	}
	no := func(m string) (ResultadoAnulacion, error) { return ResultadoAnulacion{Error: m}, nil }

	var p struct {
		numero, origen, estado string
		total                  jsmath.Num
		medio, sucursal        *string
		cliente, notas         *string
	}
	err := tx.QueryRow(ctx, `
		SELECT numero, origen::text, estado::text, total, medio_pago::text, branch_id, customer_id, notas
		FROM orders WHERE id::text = $1 LIMIT 1 FOR UPDATE`, id).
		Scan(&p.numero, &p.origen, &p.estado, &p.total, &p.medio, &p.sucursal, &p.cliente, &p.notas)
	if errors.Is(err, pgx.ErrNoRows) {
		return no("No encontramos la venta.")
	}
	if err != nil {
		return ResultadoAnulacion{}, err
	}
	if p.origen != "mostrador" {
		return no("Esto anula ventas de mostrador. Un pedido del sitio se cancela desde Pedidos.")
	}
	if p.estado == "cancelado" {
		return no("Esa venta ya estaba anulada.")
	}
	total := p.total.F()

	type item struct {
		variante *string
		cantidad jsmath.Num
		factor   jsmath.Num
	}
	var items []item
	filas, err := tx.Query(ctx, `SELECT variant_id, cantidad, stock_por_unidad FROM order_items WHERE order_id = $1`, id)
	if err != nil {
		return ResultadoAnulacion{}, err
	}
	for filas.Next() {
		var it item
		if err := filas.Scan(&it.variante, &it.cantidad, &it.factor); err != nil {
			filas.Close()
			return ResultadoAnulacion{}, err
		}
		items = append(items, it)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return ResultadoAnulacion{}, err
	}

	// Cómo se pagó de verdad: order_payments, o el medio único de las viejas.
	type renglon struct {
		medio   string
		importe jsmath.Num
	}
	var detalle []renglon
	filas, err = tx.Query(ctx, `SELECT medio::text, importe FROM order_payments WHERE order_id = $1`, id)
	if err != nil {
		return ResultadoAnulacion{}, err
	}
	for filas.Next() {
		var x renglon
		if err := filas.Scan(&x.medio, &x.importe); err != nil {
			filas.Close()
			return ResultadoAnulacion{}, err
		}
		detalle = append(detalle, x)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return ResultadoAnulacion{}, err
	}
	parte := func(medio string) float64 {
		if len(detalle) > 0 {
			s := 0.0
			for _, x := range detalle {
				if x.medio == medio {
					s += x.importe.F()
				}
			}
			return s
		}
		if p.medio != nil && *p.medio == medio {
			return total
		}
		return 0
	}
	parteEfectivo := parte(ventas.Efectivo)
	parteCuenta := parte(ventas.CuentaCorriente)

	// Los cheques con que se pagó: si alguno ya salió de la cartera, no.
	type cheque struct{ id, estado, numero string }
	var cheques []cheque
	filas, err = tx.Query(ctx, `
		SELECT c.id, c.estado::text, c.numero FROM cheques c
		JOIN order_payments p ON p.id = c.order_payment_id WHERE p.order_id = $1`, id)
	if err != nil {
		return ResultadoAnulacion{}, err
	}
	for filas.Next() {
		var c cheque
		if err := filas.Scan(&c.id, &c.estado, &c.numero); err != nil {
			filas.Close()
			return ResultadoAnulacion{}, err
		}
		cheques = append(cheques, c)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return ResultadoAnulacion{}, err
	}
	for _, c := range cheques {
		if c.estado != "cartera" && c.estado != "anulado" {
			return no("El cheque N° " + c.numero + " de esta venta ya salió de la cartera. Resolvelo desde Cheques antes de anular.")
		}
	}

	var enAcopio, conRetiro bool
	if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM stock_reservations WHERE order_id = $1 AND estado = 'activa')`, id).Scan(&enAcopio); err != nil {
		return ResultadoAnulacion{}, err
	}
	if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM deliveries WHERE order_id = $1 AND estado <> 'anulada')`, id).Scan(&conRetiro); err != nil {
		return ResultadoAnulacion{}, err
	}
	if conRetiro {
		return no("Esta venta ya tiene retiros con remito. Anulá o revisá las entregas desde la ficha del pedido.")
	}

	var sesion *string
	if parteEfectivo > 0 && p.sucursal != nil {
		var turno string
		err := tx.QueryRow(ctx, `SELECT id FROM cash_sessions WHERE branch_id = $1 AND estado = 'abierta' LIMIT 1`, *p.sucursal).Scan(&turno)
		if errors.Is(err, pgx.ErrNoRows) {
			return no("La venta fue en efectivo y no hay caja abierta. Abrí la caja para poder devolver la plata.")
		}
		if err != nil {
			return ResultadoAnulacion{}, err
		}
		sesion = &turno
	}

	// 1. El stock vuelve (o se libera la reserva del acopio).
	if enAcopio {
		if err := reservas.LiberarReservas(ctx, tx, id); err != nil {
			return ResultadoAnulacion{}, err
		}
	} else if p.sucursal != nil {
		type vuelta struct {
			variante string
			unidades float64
		}
		var vueltas []vuelta
		var orden []string
		vistos := map[string]bool{}
		for _, it := range items {
			if it.variante == nil {
				continue
			}
			u := ventas.UnidadesDeStock(it.cantidad.F(), it.factor.F())
			if u <= 0 {
				continue
			}
			vueltas = append(vueltas, vuelta{*it.variante, u})
			if !vistos[*it.variante] {
				vistos[*it.variante] = true
				orden = append(orden, *it.variante)
			}
		}
		sort.Strings(orden)
		for _, v := range orden {
			if err := reservas.Bloquear(ctx, tx, v, *p.sucursal); err != nil {
				return ResultadoAnulacion{}, err
			}
		}
		for _, x := range vueltas {
			if _, err := tx.Exec(ctx, `UPDATE inventory SET qty = qty + $3::numeric, updated_at = now() WHERE variant_id = $1 AND branch_id = $2`,
				x.variante, *p.sucursal, jsmath.Texto(x.unidades)); err != nil {
				return ResultadoAnulacion{}, err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id)
				VALUES ($1, $2, 'devolucion', $3::numeric, $4, $5)`, x.variante, *p.sucursal, jsmath.Texto(x.unidades), "Anulación "+p.numero, usuario); err != nil {
				return ResultadoAnulacion{}, err
			}
		}
	}

	// Los cheques en cartera vuelven al cliente.
	for _, c := range cheques {
		if c.estado != "cartera" {
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE cheques SET estado = 'anulado', updated_at = now() WHERE id = $1`, c.id); err != nil {
			return ResultadoAnulacion{}, err
		}
	}

	// 2. La plata sale de la caja: solo la parte en efectivo.
	if sesion != nil {
		if _, err := tx.Exec(ctx, `
			INSERT INTO cash_movements (session_id, tipo, monto, motivo, order_id, creado_por)
			VALUES ($1, 'devolucion', $2::numeric, $3, $4, $5)`,
			*sesion, jsmath.Fijo2(-parteEfectivo), "Anulación "+p.numero+": "+motivo, id, usuario); err != nil {
			return ResultadoAnulacion{}, err
		}
	}

	// 3. La deuda se cancela con otro asiento.
	if parteCuenta > 0 && p.cliente != nil {
		if _, err := tx.Exec(ctx, `
			INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
			VALUES ($1, 'nota_credito', $2::numeric, $3, $4, $5)`,
			*p.cliente, jsmath.Fijo2(-parteCuenta), "Anulación de la venta "+p.numero+": "+motivo, p.numero, usuario); err != nil {
			return ResultadoAnulacion{}, err
		}
	}

	// 4. El cobro pasa a reintegrado.
	if _, err := tx.Exec(ctx, `UPDATE payments SET estado = 'reintegrado', updated_at = now() WHERE order_id = $1 AND estado = 'aprobado'`, id); err != nil {
		return ResultadoAnulacion{}, err
	}
	var notas []string
	if p.notas != nil && *p.notas != "" {
		notas = append(notas, *p.notas)
	}
	notas = append(notas, "Anulada: "+motivo)
	if _, err := tx.Exec(ctx, `UPDATE orders SET estado = 'cancelado', estado_pago = 'reintegrado', notas = $2, updated_at = now() WHERE id = $1`,
		id, strings.Join(notas, "\n")); err != nil {
		return ResultadoAnulacion{}, err
	}

	// El trabajo de corte que todavía no se cortó se cae con la venta.
	if _, err := tx.Exec(ctx, `UPDATE cutting_orders SET estado = 'cancelado', updated_at = now() WHERE order_id = $1 AND estado IN ('en-cola', 'en-proceso')`, id); err != nil {
		return ResultadoAnulacion{}, err
	}

	var factura struct {
		id     string
		estado string
	}
	err = tx.QueryRow(ctx, `SELECT id, estado::text FROM invoices WHERE order_id = $1 LIMIT 1`, id).Scan(&factura.id, &factura.estado)
	r := ResultadoAnulacion{Ok: true, Numero: p.numero}
	if err == nil && factura.estado != "anulada" {
		r.FacturaPendiente = &factura.id
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return ResultadoAnulacion{}, err
	}
	return r, nil
}
