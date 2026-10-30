package reportes

import (
	"context"
	"time"

	"mjbj/internal/jsmath"
)

// Los asientos de cobro del cierre. Antes salían solo de los cobros de una
// factura (invoice_payments): lo que se cobraba con recibo sin pasar por una
// factura —la cuenta corriente desde la ficha o el mostrador, Mercado Pago,
// una transferencia, un cheque aceptado, una retención— no se asentaba, y
// «Deudores por ventas» del CSV no coincidía con las cuentas corrientes.
//
// Ahora hay tres fuentes que no se pisan:
//
//   - **Los recibos** (receipts + receipt_parts): toda la plata que entra de
//     un cliente fuera del carrito pasa por cobros.EmitirRecibo, también el
//     cobro de una factura. El recibo emitido en el período se asienta; el
//     anulado, además, con su contraasiento en la fecha de anulación.
//   - **Los cobros de una factura sin recibo** (invoice_payments con
//     receipt_id nulo): los de antes de los recibos. Los que tienen recibo
//     ya están en el recibo y no se asientan otra vez.
//   - **Los pagos sin recibo** (payments que ninguna parte de recibo
//     nombra): la venta del mostrador cobrada al contado y el pedido pagado
//     en línea no emiten recibo. Se asientan contra Deudores **solo si el
//     pedido tiene factura** (con CAE), que es la que debitó Deudores, y si
//     esa factura no tiene cobros propios. La fecha es la del cobro o, si la
//     factura salió después, la de la factura: así un mes ya cerrado no
//     cambia porque se facture tarde. Una venta sin factura no tiene asiento
//     de venta, así que tampoco de cobro. También entran los pagos de deuda
//     de antes de los recibos.
//
// Los reintegros (el pago reintegrado, la venta del mostrador anulada, los
// tramos de un reintegro parcial en payment_refunds) son el cobro al revés.

func mayorFecha(a time.Time, b *time.Time) time.Time {
	if b != nil && b.After(a) {
		return *b
	}
	return a
}

func entre(t, desde, hasta time.Time) bool { return !t.Before(desde) && !t.After(hasta) }

// asientosDeCobro son los cobros del período, con idesde/ihasta ya en el
// mes argentino (son instantes).
func (s *Servicio) asientosDeCobro(ctx context.Context, idesde, ihasta time.Time) ([]Asiento, error) {
	asientos := []Asiento{}

	// 1. Los cobros de una factura de antes de los recibos.
	rs, err := s.pool.Query(ctx, `
		SELECT p.fecha, i.tipo::text, i.punto_venta, i.numero, i.receptor_nombre, p.monto, p.medio::text
		FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
		WHERE p.fecha >= $1 AND p.fecha <= $2 AND p.medio <> 'cuenta_corriente' AND p.receipt_id IS NULL
		ORDER BY p.fecha`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var fecha time.Time
		var tipo, cliente, medio string
		var pv, nro int64
		var monto jsmath.Num
		if err := rs.Scan(&fecha, &tipo, &pv, &nro, &cliente, &monto, &medio); err != nil {
			rs.Close()
			return nil, err
		}
		asientos = append(asientos, AsientoDeCobro(CobroAAsentar{Fecha: fecha,
			Comprobante: NombreComprobante(tipo) + " " + NumeroFormateado(pv, nro), Cliente: cliente, Importe: monto.F(), Medio: medio}))
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	// 2. Los recibos emitidos o anulados en el período.
	rs, err = s.pool.Query(ctx, `
		SELECT r.id, r.numero, r.recibido_de, r.created_at, r.anulado_at, p.medio::text, p.importe
		FROM receipts r JOIN receipt_parts p ON p.receipt_id = r.id
		WHERE (r.created_at >= $1 AND r.created_at <= $2) OR (r.anulado_at >= $1 AND r.anulado_at <= $2)
		ORDER BY r.created_at, r.id, p.orden`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	type recibo struct {
		numero, cliente string
		emitido         time.Time
		anulado         *time.Time
		partes          []ParteDeRecibo
	}
	var recibos []*recibo
	porID := map[string]*recibo{}
	for rs.Next() {
		var id, numero, cliente, medio string
		var emitido time.Time
		var anulado *time.Time
		var importe jsmath.Num
		if err := rs.Scan(&id, &numero, &cliente, &emitido, &anulado, &medio, &importe); err != nil {
			rs.Close()
			return nil, err
		}
		r, ok := porID[id]
		if !ok {
			r = &recibo{numero: numero, cliente: cliente, emitido: emitido, anulado: anulado}
			porID[id] = r
			recibos = append(recibos, r)
		}
		r.partes = append(r.partes, ParteDeRecibo{Medio: medio, Importe: importe.F()})
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}
	for _, r := range recibos {
		if entre(r.emitido, idesde, ihasta) {
			asientos = append(asientos, AsientoDeRecibo(ReciboAAsentar{Fecha: r.emitido, Numero: r.numero, Cliente: r.cliente, Partes: r.partes}))
		}
		if r.anulado != nil && entre(*r.anulado, idesde, ihasta) {
			asientos = append(asientos, AsientoDeRecibo(ReciboAAsentar{Fecha: *r.anulado, Numero: r.numero, Cliente: r.cliente,
				Partes: r.partes, Anulacion: true}))
		}
	}

	// 3. El tramo de un reintegro parcial de un pago con recibo: solo el que
	// devolvió deuda a la cuenta (con movimiento), igual que la cuenta.
	rs, err = s.pool.Query(ctx, `
		SELECT f.created_at, f.importe, r.numero, r.recibido_de, x.medio::text
		FROM payment_refunds f
		JOIN receipt_parts x ON x.payment_id = f.payment_id
		JOIN receipts r ON r.id = x.receipt_id
		WHERE f.account_movement_id IS NOT NULL AND f.created_at >= $1 AND f.created_at <= $2
		ORDER BY f.created_at`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var fecha time.Time
		var importe jsmath.Num
		var numero, cliente, medio string
		if err := rs.Scan(&fecha, &importe, &numero, &cliente, &medio); err != nil {
			rs.Close()
			return nil, err
		}
		asientos = append(asientos, AsientoDeReintegro(CobroAAsentar{Fecha: fecha, Comprobante: "parcial del recibo " + numero,
			Cliente: cliente, Importe: importe.F(), Medio: medio}))
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	// 4. Los pagos sin recibo: la venta del mostrador y el pedido en línea
	// facturados, y la deuda pagada antes de los recibos. Qué cae en el
	// período (el cobro, el reintegro o un tramo) se decide en Go, con la
	// fecha corrida a la de la factura.
	rs, err = s.pool.Query(ctx, `
		SELECT p.id, p.tipo::text, coalesce(p.medio, ''), p.monto, p.estado::text, p.updated_at,
		       coalesce(p.acreditado_at, CASE WHEN p.proveedor = 'mostrador' THEN coalesce(o.cobrada_at, o.created_at) END,
		                p.conciliado_at, p.created_at),
		       f.fecha_emision, f.tipo, f.punto_venta, f.numero, o.numero,
		       coalesce(f.receptor_nombre, nullif(c.razon_social, ''), c.nombre, o.contacto_nombre, ''),
		       coalesce((SELECT json_agg(json_build_object('fecha', x.created_at, 'importe', x.importe::float8) ORDER BY x.created_at)
		                 FROM payment_refunds x WHERE x.payment_id = p.id), '[]'::json)
		FROM payments p
		LEFT JOIN orders o ON o.id = p.order_id
		LEFT JOIN customers c ON c.id = p.customer_id
		LEFT JOIN LATERAL (
		  SELECT i.id, i.fecha_emision, i.tipo::text AS tipo, i.punto_venta, i.numero, i.receptor_nombre FROM invoices i
		  WHERE i.order_id = p.order_id AND i.tipo::text LIKE 'factura%' AND i.estado <> 'borrador' AND i.cae IS NOT NULL
		  ORDER BY (i.estado = 'anulada'), i.fecha_emision LIMIT 1) f ON true
		WHERE p.estado IN ('aprobado', 'reintegrado')
		  AND NOT EXISTS (SELECT 1 FROM receipt_parts x WHERE x.payment_id = p.id)
		  AND ((p.tipo = 'pedido' AND f.id IS NOT NULL
		        AND NOT EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.invoice_id = f.id AND ip.medio <> 'cuenta_corriente'))
		    OR (p.tipo = 'deuda' AND p.customer_id IS NOT NULL))`)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var id, tipo, medio, estado, cliente string
		var monto jsmath.Num
		var actualizado, cobrado time.Time
		var factura *time.Time
		var tipoFactura, pedido *string
		var pv, nro *int64
		var tramos []struct {
			Fecha   time.Time `json:"fecha"`
			Importe float64   `json:"importe"`
		}
		if err := rs.Scan(&id, &tipo, &medio, &monto, &estado, &actualizado, &cobrado, &factura, &tipoFactura, &pv, &nro, &pedido,
			&cliente, &tramos); err != nil {
			rs.Close()
			return nil, err
		}
		comprobante := "de cuenta corriente"
		if tipo == "pedido" && tipoFactura != nil {
			comprobante = NombreComprobante(*tipoFactura) + " " + NumeroFormateado(*pv, *nro)
			if pedido != nil {
				comprobante += " (pedido " + *pedido + ")"
			}
		}
		c := CobroAAsentar{Comprobante: comprobante, Cliente: cliente, Medio: medio, Importe: monto.F()}
		if f := mayorFecha(cobrado, factura); entre(f, idesde, ihasta) {
			c.Fecha = f
			asientos = append(asientos, AsientoDeCobro(c))
		}
		devuelto := 0.0
		for _, t := range tramos {
			devuelto = float64(devuelto + t.Importe)
			if f := mayorFecha(t.Fecha, factura); entre(f, idesde, ihasta) {
				r := c
				r.Fecha, r.Importe, r.Comprobante = f, t.Importe, "parcial "+comprobante
				asientos = append(asientos, AsientoDeReintegro(r))
			}
		}
		// Reintegrado entero: lo que no se devolvió ya en tramos.
		if resto := float64(monto.F() - devuelto); estado == "reintegrado" && resto > toleranciaAsiento {
			if f := mayorFecha(actualizado, factura); entre(f, idesde, ihasta) {
				r := c
				r.Fecha, r.Importe = f, resto
				asientos = append(asientos, AsientoDeReintegro(r))
			}
		}
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}
	return asientos, nil
}
