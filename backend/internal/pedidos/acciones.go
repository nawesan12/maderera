package pedidos

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/reservas"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
)

// Las acciones de app/admin/ventas-actions.ts. Los avisos al cliente
// (WhatsApp y correo al avanzar) y las revalidaciones siguen en la acción de
// Next, que los dispara con lo que devuelve esto.

// Resultado es lo que contesta una acción: el mensaje y, según cuál, el
// estado al que llegó el pedido y su número.
type Resultado struct {
	Ok     string `json:"ok"`
	ID     string `json:"id,omitempty"`
	Numero string `json:"numero,omitempty"`
	Estado string `json:"estado,omitempty"`
}

// OrdenDelPedido es el recorrido, fijo y de una sola dirección.
var OrdenDelPedido = []string{"pendiente", "preparando", "listo", "en-camino", "entregado"}

var textoDelEstado = map[string]string{
	"preparando": "en preparación",
	"listo":      "listo para retirar",
	"en-camino":  "en camino",
	"entregado":  "entregado",
}

func (s *Servicio) enTransaccion(ctx context.Context, f func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := f(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Servicio) anotar(ctx context.Context, ses *auth.Sesion, accion bitacora.Accion, entidad, id, descripcion string, detalle any) {
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, entidad, id, descripcion, detalle)
}

type filaDePedido struct {
	numero, estado, tipoEntrega, estadoPago, total string
	medioPago, customerID                          *string
}

// bloquearPedido lee el pedido y bloquea su fila hasta el final de la
// transacción: es lo que ordena dos acciones sobre el mismo pedido.
func bloquearPedido(ctx context.Context, tx pgx.Tx, id string) (*filaDePedido, error) {
	var p filaDePedido
	err := tx.QueryRow(ctx, `
		SELECT numero, estado::text, tipo_entrega::text, estado_pago::text, total::text, medio_pago::text, customer_id
		FROM orders WHERE id = $1 FOR UPDATE`, id).Scan(&p.numero, &p.estado, &p.tipoEntrega, &p.estadoPago, &p.total, &p.medioPago, &p.customerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, noEsta("No se encontró el pedido.")
	}
	return &p, err
}

// Avanzar lleva el pedido al estado siguiente. Uno de retiro pasa de
// «listo» a «entregado»; uno con envío, a «en camino». No se vuelve atrás:
// para deshacer se cancela, que deja rastro.
func (s *Servicio) Avanzar(ctx context.Context, ses *auth.Sesion, id string) (*Resultado, error) {
	var p *filaDePedido
	var siguiente string
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		var err error
		if p, err = bloquearPedido(ctx, tx, id); err != nil {
			return err
		}
		switch p.estado {
		case "entregado":
			return fallo("El pedido ya está entregado.")
		case "cancelado":
			return fallo("El pedido está cancelado.")
		}
		posicion := -1
		for i, e := range OrdenDelPedido {
			if e == p.estado {
				posicion = i
			}
		}
		if posicion+1 < len(OrdenDelPedido) {
			siguiente = OrdenDelPedido[posicion+1]
		}
		if p.estado == "listo" && p.tipoEntrega == "retiro" {
			siguiente = "entregado"
		}
		if siguiente == "" {
			return fallo("No hay un estado siguiente.")
		}
		if _, err := tx.Exec(ctx, `UPDATE orders SET estado = $2, updated_at = now() WHERE id = $1`, id, siguiente); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, created_by_user_id) VALUES ($1, $2, $3)`,
			id, siguiente, ses.UserID)
		return err
	})
	if err != nil {
		return nil, err
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCambiarEstado, "pedido", id, p.numero+": "+p.estado+" → "+siguiente, nil)
	texto := textoDelEstado[siguiente]
	if texto == "" {
		texto = siguiente
	}
	return &Resultado{Ok: p.numero + " quedó " + texto + ".", Numero: p.numero, Estado: siguiente}, nil
}

// Cancelar cancela el pedido y libera lo reservado (el físico no se toca:
// nunca salió del galpón). Un pedido ya cancelado no se cancela de nuevo.
func (s *Servicio) Cancelar(ctx context.Context, ses *auth.Sesion, id string, motivo *string) (*Resultado, error) {
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		p, err := bloquearPedido(ctx, tx, id)
		if err != nil {
			return err
		}
		if p.estado == "cancelado" {
			return fallo("El pedido ya está cancelado.")
		}
		if _, err := tx.Exec(ctx, `UPDATE orders SET estado = 'cancelado', updated_at = now() WHERE id = $1`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, 'cancelado', $2, $3)`,
			id, motivo, ses.UserID); err != nil {
			return err
		}
		return reservas.LiberarReservas(ctx, tx, id)
	})
	if err != nil {
		return nil, err
	}
	desc := "Canceló el pedido"
	if motivo != nil && *motivo != "" {
		desc += ": " + *motivo
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaAnular, "pedido", id, desc, nil)
	return &Resultado{Ok: "Pedido cancelado. La mercadería reservada quedó disponible.", Estado: "cancelado"}, nil
}

// MarcarPagado anota como cobrado lo que ya se cobró por otro lado. Un
// pedido a cuenta corriente no pasa por acá: su cobro baja la deuda, y eso
// va con recibo.
func (s *Servicio) MarcarPagado(ctx context.Context, ses *auth.Sesion, id string) (*Resultado, error) {
	var p *filaDePedido
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		var err error
		if p, err = bloquearPedido(ctx, tx, id); err != nil {
			return err
		}
		if p.estadoPago == "pagado" {
			return fallo("Ya figura como pagado.")
		}
		if p.medioPago != nil && *p.medioPago == "cuenta_corriente" && p.customerID != nil {
			return fallo("Es a cuenta corriente: registrá el cobro con el medio con que pagó, así sale el recibo y baja la deuda.")
		}
		_, err = tx.Exec(ctx, `UPDATE orders SET estado_pago = 'pagado', updated_at = now() WHERE id = $1`, id)
		return err
	})
	if err != nil {
		return nil, err
	}
	medio := "sin medio"
	if p.medioPago != nil {
		medio = *p.medioPago
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCobrar, "pedido", id, "Marcó "+p.numero+" como cobrado ("+medio+")",
		struct {
			Total     string  `json:"total"`
			MedioPago *string `json:"medioPago"`
		}{p.total, p.medioPago})
	return &Resultado{Ok: p.numero + " quedó cobrado.", Numero: p.numero}, nil
}

// EstadosDePresupuesto son los del enum estado_presupuesto.
var EstadosDePresupuesto = []string{"pendiente", "revision", "enviado", "aceptado", "rechazado", "vencido"}

// CambiarEstadoPresupuesto acepta, rechaza o mueve un presupuesto.
func (s *Servicio) CambiarEstadoPresupuesto(ctx context.Context, ses *auth.Sesion, id, estado string) (*Resultado, error) {
	valido := false
	for _, e := range EstadosDePresupuesto {
		valido = valido || e == estado
	}
	if !valido {
		return nil, fallo("Ese estado no existe.")
	}
	tag, err := s.pool.Exec(ctx, `UPDATE quotes SET estado = $2, updated_at = now() WHERE id = $1`, id, estado)
	if err != nil {
		return nil, err
	}
	// El TS contestaba «actualizado» aunque el presupuesto no existiera.
	if tag.RowsAffected() == 0 {
		return nil, noEsta("No se encontró el presupuesto.")
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCambiarEstado, "presupuesto", id, "Pasó el presupuesto a "+estado, nil)
	return &Resultado{Ok: "Presupuesto actualizado.", Estado: estado}, nil
}

// ConvertirEnPedido pasa un presupuesto a pedido: copia las líneas con el
// precio que tenían (el cliente aceptó ese número), congela el costo del
// momento, lee del producto cuánto stock mueve cada línea y reserva la
// mercadería. La fila del presupuesto queda bloqueada mientras tanto: la
// misma conversión dos veces a la vez da un solo pedido (en el TS daba dos,
// con la mercadería reservada dos veces).
func (s *Servicio) ConvertirEnPedido(ctx context.Context, ses *auth.Sesion, quoteID string) (*Resultado, error) {
	var numero, pedidoID, numeroPresupuesto string
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		var q struct {
			customerID, email, telefono, branchID, notas, sellerID *string
			nombre, subtotal, total                                string
		}
		err := tx.QueryRow(ctx, `
			SELECT numero, customer_id, contacto_nombre, contacto_email, contacto_telefono, branch_id, subtotal::text, total::text,
			       notas, seller_id
			FROM quotes WHERE id = $1 FOR UPDATE`, quoteID).Scan(&numeroPresupuesto, &q.customerID, &q.nombre, &q.email, &q.telefono,
			&q.branchID, &q.subtotal, &q.total, &q.notas, &q.sellerID)
		if errors.Is(err, pgx.ErrNoRows) {
			return noEsta("No se encontró el presupuesto.")
		}
		if err != nil {
			return err
		}
		var ya string
		err = tx.QueryRow(ctx, `SELECT numero FROM orders WHERE quote_id = $1 LIMIT 1`, quoteID).Scan(&ya)
		if err == nil {
			return fallo("Ya se convirtió en el pedido " + ya + ".")
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		type linea struct {
			variantID, presentacion                     *string
			descripcion, unidad, cantidad, precio, subt string
			orden                                       int
		}
		filas, err := tx.Query(ctx, `
			SELECT variant_id, presentacion, descripcion, unidad, cantidad::text, precio_unitario::text, subtotal::text, orden
			FROM quote_items WHERE quote_id = $1 ORDER BY orden, id`, quoteID)
		if err != nil {
			return err
		}
		var lineas []linea
		for filas.Next() {
			var l linea
			if err := filas.Scan(&l.variantID, &l.presentacion, &l.descripcion, &l.unidad, &l.cantidad, &l.precio, &l.subt, &l.orden); err != nil {
				filas.Close()
				return err
			}
			lineas = append(lineas, l)
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return err
		}
		if len(lineas) == 0 {
			return fallo("El presupuesto está vacío: no tiene ningún producto.")
		}

		if numero, err = numeracion.Pedido(ctx, tx); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO orders (numero, customer_id, quote_id, contacto_nombre, contacto_email, contacto_telefono, branch_id,
			                    estado, origen, subtotal, total, notas, seller_id, created_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente', 'presupuesto', $8::numeric, $9::numeric, $10, $11, $12)
			RETURNING id`, numero, q.customerID, quoteID, q.nombre, q.email, q.telefono, q.branchID, q.subtotal, q.total, q.notas,
			q.sellerID, ses.UserID).Scan(&pedidoID); err != nil {
			return err
		}

		var variantes []string
		conPresentacion := make([]reservas.LineaConPresentacion, len(lineas))
		for i, l := range lineas {
			if l.variantID != nil {
				variantes = append(variantes, *l.variantID)
			}
			conPresentacion[i] = reservas.LineaConPresentacion{VariantID: l.variantID, Presentacion: l.presentacion}
		}
		costos, err := reservas.CostosParaCongelar(ctx, tx, variantes)
		if err != nil {
			return err
		}
		factores, err := reservas.FactoresDeStock(ctx, tx, conPresentacion)
		if errors.Is(err, ventas.ErrSinMedidas) {
			return fallo(err.Error())
		}
		if err != nil {
			return err
		}
		for i, l := range lineas {
			var costo *string
			var alicuota *string
			if l.variantID != nil {
				if c, ok := costos[*l.variantID]; ok {
					costo = c.CostoUnitario
					a := c.AlicuotaIva
					alicuota = &a
				}
			}
			f := factores[i]
			if _, err := tx.Exec(ctx, `
				INSERT INTO order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal,
				                         presentacion, stock_por_unidad, costo_unitario, alicuota_iva, orden)
				VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9::numeric, $10::numeric, $11::numeric, $12)`,
				pedidoID, l.variantID, l.descripcion, l.unidad, l.cantidad, l.precio, l.subt, f.Presentacion,
				jsmath.Texto(f.StockPorUnidad), reservas.CostoPorUnidadDeVenta(costo, f.StockPorUnidad), alicuota, l.orden); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, 'pendiente', $2, $3)`,
			pedidoID, "Generado desde el presupuesto "+numeroPresupuesto, ses.UserID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE quotes SET estado = 'aceptado', updated_at = now() WHERE id = $1`, quoteID); err != nil {
			return err
		}
		// Desde acá la mercadería tiene dueño y deja de estar disponible
		// para el resto, aunque siga en el galpón hasta que la retiren.
		return reservas.ReservarPedido(ctx, tx, pedidoID)
	})
	if err != nil {
		return nil, err
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "pedido", quoteID,
		"Convirtió el presupuesto "+numeroPresupuesto+" en el pedido "+numero, nil)
	return &Resultado{Ok: "Se creó el pedido " + numero + ".", ID: pedidoID, Numero: numero}, nil
}
