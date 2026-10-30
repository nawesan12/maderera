package pedidos

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/cola"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/reservas"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
)

// Las acciones de app/admin/ventas-actions.ts. Los avisos al cliente
// (WhatsApp y correo al avanzar) quedan en la cola en la misma transacción
// (pedido.estado, los manda el worker); las revalidaciones siguen en la
// acción de Next.

// TrabajoCambioDeEstado es el aviso de un pedido que avanzó.
const TrabajoCambioDeEstado = "pedido.estado"

// TrabajoPresupuestoEnviado es el aviso de un presupuesto armado: el
// correo con el detalle y el WhatsApp con el PDF (presupuesto_listo).
const TrabajoPresupuestoEnviado = "presupuesto.enviado"

// EncolarPresupuestoEnviado deja el aviso del presupuesto armado en la
// cola, dentro de la transacción de quien lo pasa a «enviado».
func EncolarPresupuestoEnviado(ctx context.Context, tx pgx.Tx, quoteID string) error {
	_, err := cola.Encolar(ctx, sqlc.New(tx), TrabajoPresupuestoEnviado, map[string]string{"quoteId": quoteID}, time.Time{})
	return err
}

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
	numero, estado, tipoEntrega, estadoPago, total, origen string
	medioPago, customerID                                  *string
}

// bloquearPedido lee el pedido y bloquea su fila hasta el final de la
// transacción: es lo que ordena dos acciones sobre el mismo pedido.
func bloquearPedido(ctx context.Context, tx pgx.Tx, id string) (*filaDePedido, error) {
	var p filaDePedido
	err := tx.QueryRow(ctx, `
		SELECT numero, estado::text, tipo_entrega::text, estado_pago::text, total::text, origen::text, medio_pago::text, customer_id
		FROM orders WHERE id = $1 FOR UPDATE`, id).Scan(&p.numero, &p.estado, &p.tipoEntrega, &p.estadoPago, &p.total, &p.origen, &p.medioPago, &p.customerID)
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
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, created_by_user_id) VALUES ($1, $2, $3)`,
			id, siguiente, ses.UserID); err != nil {
			return err
		}
		_, err = cola.Encolar(ctx, sqlc.New(tx), TrabajoCambioDeEstado, map[string]string{"orderId": id, "estado": siguiente}, time.Time{})
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
//
// Si el pedido cargó deuda en la cuenta corriente (la compra a cuenta de la
// tienda), la cancelación la devuelve con una nota de crédito, una sola vez:
// antes el pedido quedaba cancelado y la deuda seguía en la cuenta. Una
// venta del mostrador no se cancela acá: se anula desde el mostrador, que
// además devuelve el stock que salió y el efectivo de la caja.
func (s *Servicio) Cancelar(ctx context.Context, ses *auth.Sesion, id string, motivo *string) (*Resultado, error) {
	devuelto := 0.0
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		p, err := bloquearPedido(ctx, tx, id)
		if err != nil {
			return err
		}
		if p.estado == "cancelado" {
			return fallo("El pedido ya está cancelado.")
		}
		if p.origen == "mostrador" {
			return fallo("Es una venta del mostrador: anulala desde el mostrador, que devuelve el stock, el efectivo de la caja y la deuda.")
		}
		if p.customerID != nil {
			if devuelto, err = devolverDeuda(ctx, tx, *p.customerID, p.numero, motivo, ses.UserID); err != nil {
				return err
			}
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
	ok := "Pedido cancelado. La mercadería reservada quedó disponible."
	if devuelto > 0 {
		ok = "Pedido cancelado. La mercadería reservada quedó disponible y la deuda del pedido salió de la cuenta corriente."
	}
	return &Resultado{Ok: ok, Estado: "cancelado"}, nil
}

// devolverDeuda revierte lo que el pedido cargó en la cuenta corriente del
// cliente (los movimientos «compra» con el número del pedido como
// referencia, que es como los asienta el checkout) menos lo que ya se
// devolvió por una cancelación anterior: así se devuelve una sola vez aunque
// el pedido se cancele dos veces. Devuelve cuánto devolvió.
func devolverDeuda(ctx context.Context, tx pgx.Tx, cliente, numero string, motivo *string, usuario string) (float64, error) {
	var pendiente jsmath.Num
	if err := tx.QueryRow(ctx, `
		SELECT coalesce(sum(monto), 0) FROM account_movements
		WHERE customer_id = $1 AND referencia = $2
		  AND (tipo = 'compra' OR (tipo = 'nota_credito' AND detalle LIKE 'Cancelación del pedido %'))`, cliente, numero).Scan(&pendiente); err != nil {
		return 0, err
	}
	monto := pendiente.F()
	if jsmath.Fijo2(monto) == "0.00" || monto < 0 {
		return 0, nil
	}
	detalle := "Cancelación del pedido " + numero
	if motivo != nil && *motivo != "" {
		detalle += ": " + *motivo
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
		VALUES ($1, 'nota_credito', $2::numeric, $3, $4, $5)`, cliente, jsmath.Fijo2(-monto), detalle, numero, usuario)
	return monto, err
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
	// El estado anterior, con la fila bloqueada: el aviso al cliente sale
	// solo cuando el presupuesto llega a «enviado» desde otro estado, y dos
	// clics seguidos en «enviado» dan un solo aviso (el segundo espera al
	// primero y ya lo encuentra enviado).
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		var anterior string
		err := tx.QueryRow(ctx, `SELECT estado::text FROM quotes WHERE id = $1 FOR UPDATE`, id).Scan(&anterior)
		// El TS contestaba «actualizado» aunque el presupuesto no existiera.
		if errors.Is(err, pgx.ErrNoRows) {
			return noEsta("No se encontró el presupuesto.")
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE quotes SET estado = $2, updated_at = now() WHERE id = $1`, id, estado); err != nil {
			return err
		}
		if estado == "enviado" && anterior != "enviado" {
			return EncolarPresupuestoEnviado(ctx, tx, id)
		}
		return nil
	})
	if err != nil {
		return nil, err
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
