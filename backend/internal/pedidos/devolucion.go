package pedidos

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/entregas"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/reservas"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
	"mjbj/internal/ventas/fragmentos"
	"mjbj/internal/zodjs"
)

// La devolución de un pedido sin factura (mes simulado, 26/11/2026; migración
// 00232). La devolución parcial de Facturación nace de la factura y de su
// nota de crédito; un pedido que no se facturó no tenía camino: la vendedora
// cargaba el stock con un ajuste suelto, sin decir de qué pedido, y el pedido
// seguía cobrando lo devuelto.
//
// Las reglas:
//
//   - Solo sin factura viva: con factura, se devuelve desde la factura, que
//     emite la nota de crédito (lo emitido no se edita).
//   - De cada renglón sale primero lo que sigue en acopio (baja la reserva:
//     nunca salió del galpón) y el resto lo trae el cliente (vuelve al físico
//     de la sucursal del pedido). No se devuelve más de lo que se llevó.
//   - La plata: si el pedido es a cuenta corriente, una nota de crédito en
//     la cuenta; si no, baja lo que falta cobrar (destino «deuda», como en
//     Facturación), y no más que eso: lo ya cobrado vuelve por la caja o el
//     banco, que es la puerta de la plata (acreditarPago y emitirRecibo).
//   - Los candados, en el orden del remito: la serie de los remitos, el
//     pedido, y el stock. Una clave por intento: el doble clic devuelve la
//     misma devolución.

// RenglonDevuelto es cuánto vuelve de un renglón del pedido.
type RenglonDevuelto struct {
	OrderItemID string  `json:"orderItemId"`
	Cantidad    float64 `json:"cantidad"`
}

// DevolucionDelPedido es lo que contesta.
type DevolucionDelPedido struct {
	Ok       string  `json:"ok"`
	ID       string  `json:"id"`
	Importe  float64 `json:"importe"`
	Repetida bool    `json:"repetida,omitempty"`
}

// MsjDevolverDesdeLaFactura es el 422 de un pedido facturado.
const MsjDevolverDesdeLaFactura = "Está facturado: la devolución sale desde la factura, con su nota de crédito."

// DevolverSinFactura hace la devolución de un pedido sin factura.
func (s *Servicio) DevolverSinFactura(ctx context.Context, ses *auth.Sesion, pedido string, renglones []RenglonDevuelto, motivo, clave string) (*DevolucionDelPedido, error) {
	motivo = zodjs.TrimJS(motivo)
	if motivo == "" {
		return nil, plataforma.Invalido(map[string]string{"motivo": "Escribí por qué devuelve."})
	}
	if clave == "" || len(clave) > 80 {
		return nil, plataforma.Invalido(map[string]string{"clave": "Falta la clave de la devolución."})
	}
	var out DevolucionDelPedido
	var numero string
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		if err := numeracion.BloquearRemitos(ctx, tx); err != nil {
			return err
		}
		var ya struct {
			id      string
			importe float64
		}
		err := tx.QueryRow(ctx, `SELECT id::text, importe::float8 FROM devoluciones WHERE clave = $1`, clave).Scan(&ya.id, &ya.importe)
		if err == nil {
			out = DevolucionDelPedido{Ok: "Devolución registrada.", ID: ya.id, Importe: ya.importe, Repetida: true}
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		p, err := bloquearPedido(ctx, tx, pedido)
		if err != nil {
			return err
		}
		numero = p.numero
		if p.estado == "cancelado" {
			return fallo("El pedido está cancelado.")
		}
		var facturado, aCuenta bool
		var sucursal *string
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM invoices f WHERE f.order_id = o.id AND f.estado NOT IN ('anulada', 'borrador') AND f.tipo::text LIKE 'factura%'),
			       o.customer_id IS NOT NULL AND (o.medio_pago = 'cuenta_corriente' OR EXISTS (SELECT 1 FROM account_movements am
			         WHERE am.customer_id = o.customer_id AND am.referencia = o.numero AND am.tipo = 'compra')),
			       o.branch_id::text
			FROM orders o WHERE o.id = $1`, pedido).Scan(&facturado, &aCuenta, &sucursal); err != nil {
			return err
		}
		if facturado {
			return fallo(MsjDevolverDesdeLaFactura)
		}

		saldo, err := entregas.SaldoConServicios(ctx, tx, pedido)
		if err != nil {
			return err
		}
		pendiente := map[string]float64{}
		entregado := map[string]float64{}
		for _, r := range saldo {
			pendiente[r.OrderItemID] = r.Pendiente
			entregado[r.OrderItemID] = r.Entregado
		}
		type item struct {
			descripcion, unidad string
			variante            *string
			cantidad, subtotal  float64
			factor              float64
			devuelto, traido    float64
		}
		items := map[string]item{}
		filas, err := tx.Query(ctx, `
			SELECT oi.id::text, oi.descripcion, oi.unidad, oi.variant_id::text, oi.cantidad::float8, oi.subtotal::float8, oi.stock_por_unidad::float8,
			       coalesce((SELECT sum(di.cantidad) FROM devolucion_items di WHERE di.order_item_id = oi.id), 0)::float8,
			       coalesce((SELECT sum(di.cantidad - di.del_acopio) FROM devolucion_items di WHERE di.order_item_id = oi.id), 0)::float8
			FROM order_items oi WHERE oi.order_id = $1`, pedido)
		if err != nil {
			return err
		}
		for filas.Next() {
			var id string
			var x item
			if err := filas.Scan(&id, &x.descripcion, &x.unidad, &x.variante, &x.cantidad, &x.subtotal, &x.factor, &x.devuelto, &x.traido); err != nil {
				filas.Close()
				return err
			}
			items[id] = x
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return err
		}

		type vuelta struct {
			orderItem, variante             string
			cantidad, delAcopio, importe    float64
			unidadesAcopio, unidadesTraidas float64
			descripcion, unidad             string
		}
		var vueltas []vuelta
		var candados []reservas.Stock
		total := 0.0
		for _, r := range renglones {
			if r.Cantidad <= 0 || math.IsNaN(r.Cantidad) || math.IsInf(r.Cantidad, 0) {
				continue
			}
			x, ok := items[r.OrderItemID]
			if !ok {
				return fallo("Uno de los renglones no es de este pedido.")
			}
			if queda := ventas.CantidadDeStock(x.cantidad - x.devuelto); r.Cantidad > queda+1e-9 {
				return fallo(`De "` + x.descripcion + `" se puede devolver hasta ` + jsmath.Texto(queda) + `.`)
			}
			delAcopio := math.Min(r.Cantidad, pendiente[r.OrderItemID])
			traido := ventas.CantidadDeStock(r.Cantidad - delAcopio)
			if llevado := ventas.CantidadDeStock(entregado[r.OrderItemID] - x.traido); traido > llevado+1e-9 {
				return fallo(`De "` + x.descripcion + `", el cliente se llevó ` + jsmath.Texto(llevado) + `: no puede traer más.`)
			}
			v := vuelta{orderItem: r.OrderItemID, cantidad: r.Cantidad, delAcopio: delAcopio, descripcion: x.descripcion, unidad: x.unidad,
				importe: ventas.ACentavos(float64(x.subtotal*r.Cantidad) / x.cantidad)}
			if x.variante != nil {
				v.variante = *x.variante
				v.unidadesAcopio = ventas.UnidadesDeStock(delAcopio, x.factor)
				v.unidadesTraidas = ventas.UnidadesDeStock(traido, x.factor)
				if v.unidadesAcopio > 0 {
					enReserva, err := reservas.ReservasDelRenglon(ctx, tx, v.orderItem)
					if err != nil {
						return err
					}
					candados = append(candados, enReserva...)
				}
				if v.unidadesTraidas > 0 {
					if sucursal == nil {
						return fallo("El pedido no tiene sucursal: no se sabe a qué depósito vuelve.")
					}
					candados = append(candados, reservas.Stock{Variante: v.variante, Sucursal: *sucursal})
				}
			}
			total = ventas.ACentavos(total + v.importe)
			vueltas = append(vueltas, v)
		}
		if len(vueltas) == 0 {
			return fallo("Elegí qué devuelve.")
		}

		destino := "deuda"
		if aCuenta {
			destino = "cuenta"
		} else {
			var falta float64
			if err := tx.QueryRow(ctx, `SELECT greatest(`+fragmentos.ACobrarDelPedido+` - `+fragmentos.CobradoDelPedido+`, 0)::float8
				FROM orders o WHERE o.id = $1`, pedido).Scan(&falta); err != nil {
				return err
			}
			if total > falta+0.005 {
				if falta <= 0.005 {
					return fallo("El pedido ya está cobrado: la plata vuelve por la caja o el banco, no desde acá.")
				}
				return fallo("Lo devuelto (" + formato.Importe(total) + ") pasa lo que falta cobrar (" + formato.Importe(falta) + ").")
			}
		}

		if err := tx.QueryRow(ctx, `INSERT INTO devoluciones (clave, order_id, importe, destino, motivo, created_by_user_id)
			VALUES ($1, $2, $3::numeric, $4, $5, $6) RETURNING id::text`,
			clave, pedido, jsmath.Fijo2(total), destino, motivo, ses.UserID).Scan(&out.ID); err != nil {
			return err
		}
		for _, v := range vueltas {
			if _, err := tx.Exec(ctx, `INSERT INTO devolucion_items (devolucion_id, order_item_id, cantidad, del_acopio, al_stock, importe)
				VALUES ($1, $2, $3::numeric, $4::numeric, $5, $6::numeric)`, out.ID, v.orderItem, jsmath.Texto(ventas.CantidadDeStock(v.cantidad)),
				jsmath.Texto(ventas.CantidadDeStock(v.delAcopio)), v.variante != "", jsmath.Fijo2(v.importe)); err != nil {
				return err
			}
		}

		// El stock, con los candados juntos y en orden.
		if err := reservas.BloquearEnOrden(ctx, tx, candados); err != nil {
			return err
		}
		nota := "Devolución " + p.numero
		for _, v := range vueltas {
			if v.variante == "" {
				continue
			}
			traidas := v.unidadesTraidas
			if v.unidadesAcopio > 0 {
				bajo, _, err := reservas.ReducirReserva(ctx, tx, v.orderItem, v.unidadesAcopio)
				if err != nil {
					return err
				}
				// Lo que no alcanzó a bajar (un redondeo) es lo que se llevó.
				traidas = ventas.CantidadDeStock(traidas + math.Max(0, v.unidadesAcopio-bajo))
			}
			if traidas <= 0 || sucursal == nil {
				continue
			}
			if _, err := tx.Exec(ctx, `INSERT INTO inventory (variant_id, branch_id, qty) VALUES ($1, $2, $3::numeric)
				ON CONFLICT (variant_id, branch_id) DO UPDATE SET qty = inventory.qty + excluded.qty, updated_at = now()`,
				v.variante, *sucursal, jsmath.Texto(traidas)); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id, documento_tipo, documento_id)
				VALUES ($1, $2, 'devolucion', $3::numeric, $4, $5, 'devolucion', $6)`, v.variante, *sucursal, jsmath.Texto(traidas), nota, ses.UserID, out.ID); err != nil {
				return err
			}
		}

		// La plata.
		if destino == "cuenta" {
			var mov string
			if err := tx.QueryRow(ctx, `INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
				VALUES ($1, 'nota_credito', $2::numeric, $3, $4, $5) RETURNING id::text`, *p.customerID, jsmath.Fijo2(-total),
				"Devolución del pedido "+p.numero+": "+motivo, p.numero, ses.UserID).Scan(&mov); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE devoluciones SET account_movement_id = $2 WHERE id = $1`, out.ID, mov); err != nil {
				return err
			}
		} else if _, err := tx.Exec(ctx, `UPDATE orders o SET estado_pago = 'pagado', updated_at = now()
			WHERE o.id = $1 AND o.estado_pago IN ('pendiente', 'rechazado')
			  AND `+fragmentos.CobradoDelPedido+` > 0.005 AND `+fragmentos.CobradoDelPedido+` + 0.005 >= `+fragmentos.ACobrarDelPedido, pedido); err != nil {
			return err
		}

		// En el historial del pedido, con lo que volvió.
		var partes []string
		for _, v := range vueltas {
			partes = append(partes, jsmath.Texto(v.cantidad)+" "+v.descripcion)
		}
		renglon := "Devolución · " + strings.Join(partes, ", ") + " · " + formato.Importe(total) + " · " + motivo
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, $2, $3, $4)`,
			pedido, p.estado, renglon, ses.UserID); err != nil {
			return err
		}
		out.Importe = total
		out.Ok = "Devolución registrada: " + formato.Importe(total) + "."
		return nil
	})
	if err != nil {
		return nil, err
	}
	if !out.Repetida {
		s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "devolucion", out.ID, "Devolución sin factura del pedido "+numero+" por "+formato.Importe(out.Importe), nil)
	}
	return &out, nil
}
