package pedidos

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/autorizacion"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/reservas"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
	"mjbj/internal/ventas/fragmentos"
	"mjbj/internal/zodjs"
)

// Corregir un pedido mal cargado (mes simulado, 26/11/2026): PED-1066 salió
// sin flete y no había cómo agregarlo; quedaba anular y volver a cargar toda
// la venta, y anular deshacía también el remito firmado.
//
// Se corrige lo que todavía no es de nadie más que de la venta: un pedido
// sin factura (lo emitido no se edita: se corrige con nota de crédito o
// débito) y sin nada cobrado (un recibo ya dice cuánto se pagó). La venta
// del mostrador se anula desde el mostrador, que devuelve la caja.
//
//   - La cantidad de un renglón no baja de lo que ya salió o se devolvió; lo
//     que cambia en lo que falta entregar sube o baja la reserva.
//   - Un precio más bajo que la lista, pasado lo libre, pide el PIN de un
//     admin, como en el mostrador y al pasar un presupuesto a pedido.
//   - Si el pedido cargó su deuda en la cuenta corriente, la diferencia va a
//     la cuenta con el número del pedido (la cancelación la sigue
//     encontrando entera).
//   - Queda en el historial qué cambió, por qué y quién lo autorizó.

// RenglonCorregido es el renglón con su cantidad y su precio nuevos.
type RenglonCorregido struct {
	OrderItemID    string  `json:"orderItemId"`
	Cantidad       float64 `json:"cantidad"`
	PrecioUnitario float64 `json:"precioUnitario"`
}

// Correccion es lo que manda la pantalla.
type Correccion struct {
	Renglones  []RenglonCorregido
	CostoEnvio *float64
	Motivo     string
	PIN, Ficha string
}

// Corregir corrige los renglones y el flete de un pedido sin factura ni
// cobro.
func (s *Servicio) Corregir(ctx context.Context, ses *auth.Sesion, pedido string, c Correccion) (*Resultado, error) {
	c.Motivo = zodjs.TrimJS(c.Motivo)
	if c.Motivo == "" {
		return nil, plataforma.Invalido(map[string]string{"motivo": "Escribí por qué se corrige."})
	}
	if c.CostoEnvio != nil && (*c.CostoEnvio < 0 || math.IsNaN(*c.CostoEnvio) || math.IsInf(*c.CostoEnvio, 0) || *c.CostoEnvio >= 1e10) {
		return nil, fallo("Revisá el flete.")
	}
	var numero, cambios, autorizo string
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		// El orden del remito: la serie, el pedido, el stock.
		if err := numeracion.BloquearRemitos(ctx, tx); err != nil {
			return err
		}
		p, err := bloquearPedido(ctx, tx, pedido)
		if err != nil {
			return err
		}
		numero = p.numero
		switch {
		case p.estado == "cancelado":
			return fallo("El pedido está cancelado.")
		case p.origen == "mostrador":
			return fallo("Es una venta del mostrador: anulala desde el mostrador y volvé a cargarla.")
		}
		var facturado, cobrado bool
		var envio, descuento float64
		var aCuenta bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM invoices f WHERE f.order_id = o.id AND f.estado NOT IN ('anulada', 'borrador')),
			       `+fragmentos.CobradoDelPedido+` > 0.005 OR `+fragmentos.PagoEnRevision+`,
			       o.costo_envio::float8, o.descuento::float8,
			       o.customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM account_movements am
			         WHERE am.customer_id = o.customer_id AND am.referencia = o.numero AND am.tipo = 'compra')
			FROM orders o WHERE o.id = $1`, pedido).Scan(&facturado, &cobrado, &envio, &descuento, &aCuenta); err != nil {
			return err
		}
		if facturado {
			return fallo("Está facturado: se corrige con una nota de crédito o de débito.")
		}
		if cobrado {
			return fallo("Ya tiene un cobro: anulá el recibo antes de corregirlo.")
		}

		type item struct {
			descripcion              string
			variante, precioLista    *string
			cantidad, precio, factor float64
			salio                    float64
		}
		items := map[string]*item{}
		var orden []string
		filas, err := tx.Query(ctx, `
			SELECT oi.id::text, oi.descripcion, oi.variant_id::text, oi.precio_lista::text, oi.cantidad::float8, oi.precio_unitario::float8,
			       oi.stock_por_unidad::float8,
			       coalesce((SELECT sum(di.cantidad) FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id
			                 WHERE di.order_item_id = oi.id AND d.estado <> 'anulada'), 0)::float8
			       + coalesce((SELECT sum(dv.cantidad) FROM devolucion_items dv WHERE dv.order_item_id = oi.id), 0)::float8
			FROM order_items oi WHERE oi.order_id = $1 ORDER BY oi.orden, oi.id`, pedido)
		if err != nil {
			return err
		}
		for filas.Next() {
			var id string
			var x item
			if err := filas.Scan(&id, &x.descripcion, &x.variante, &x.precioLista, &x.cantidad, &x.precio, &x.factor, &x.salio); err != nil {
				filas.Close()
				return err
			}
			items[id] = &x
			orden = append(orden, id)
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return err
		}

		var notas []string
		type cambio struct {
			id               string
			cantidad, precio float64
			antes            item
		}
		var cambiados []cambio
		for _, r := range c.Renglones {
			x, ok := items[r.OrderItemID]
			if !ok {
				return fallo("Uno de los renglones no es de este pedido.")
			}
			if !(r.Cantidad > 0) || math.IsInf(r.Cantidad, 0) || r.Cantidad >= 1e7 {
				return fallo(`Revisá la cantidad de "` + x.descripcion + `".`)
			}
			if r.PrecioUnitario < 0 || math.IsNaN(r.PrecioUnitario) || math.IsInf(r.PrecioUnitario, 0) || r.PrecioUnitario >= 1e10 {
				return fallo(`Revisá el precio de "` + x.descripcion + `".`)
			}
			cantidad, precio := ventas.CantidadDeStock(r.Cantidad), ventas.ACentavos(r.PrecioUnitario)
			if cantidad == x.cantidad && precio == x.precio {
				continue
			}
			if cantidad < x.salio-1e-9 {
				return fallo(`De "` + x.descripcion + `" ya salieron ` + jsmath.Texto(x.salio) + `: no puede quedar en menos.`)
			}
			cambiados = append(cambiados, cambio{id: r.OrderItemID, cantidad: cantidad, precio: precio, antes: *x})
			var n []string
			if cantidad != x.cantidad {
				n = append(n, jsmath.Texto(x.cantidad)+" → "+jsmath.Texto(cantidad))
			}
			if precio != x.precio {
				n = append(n, formato.Moneda(x.precio)+" → "+formato.Moneda(precio))
			}
			notas = append(notas, x.descripcion+": "+strings.Join(n, ", "))
			x.cantidad, x.precio = cantidad, precio
		}
		nuevoEnvio := envio
		if c.CostoEnvio != nil && ventas.ACentavos(*c.CostoEnvio) != envio {
			nuevoEnvio = ventas.ACentavos(*c.CostoEnvio)
			notas = append(notas, "Flete: "+formato.Moneda(envio)+" → "+formato.Moneda(nuevoEnvio))
		}
		if len(notas) == 0 {
			return fallo("No cambió nada.")
		}

		// Lo que se deja de cobrar contra la lista, como en el mostrador.
		renglones := make([]ventas.LineaDeVenta, 0, len(orden))
		for _, id := range orden {
			x := items[id]
			l := ventas.LineaDeVenta{VariantID: x.variante, Cantidad: x.cantidad, PrecioUnitario: x.precio}
			if x.precioLista != nil {
				v := jsmath.Numero(*x.precioLista)
				l.PrecioLista = &v
			}
			renglones = append(renglones, l)
		}
		d := ventas.DesvioDeLaVenta(renglones, 0, 0)
		libre, err := precios.PorcentajeLibre(ctx, tx)
		if err != nil {
			return err
		}
		if !d.DentroDeLoLibre(libre) {
			firma, err := s.aut.Exigir(ctx, ses, autorizacion.Pedido{Motivo: autorizacion.Precio, Monto: d.Total, Clave: pedido, PIN: c.PIN, Ficha: c.Ficha})
			var falta *autorizacion.Falta
			if errors.As(err, &falta) {
				return faltaDePIN(falta)
			}
			if err != nil {
				return err
			}
			autorizo = firma.Nombre
		}

		// La reserva sigue a lo que falta entregar.
		var subtotal float64
		for _, id := range orden {
			subtotal = ventas.ACentavos(subtotal + ventas.ACentavos(float64(items[id].cantidad*items[id].precio)))
		}
		for _, ch := range cambiados {
			if _, err := tx.Exec(ctx, `UPDATE order_items SET cantidad = $2::numeric, precio_unitario = $3::numeric, subtotal = $4::numeric WHERE id = $1`,
				ch.id, jsmath.Fijo2(ch.cantidad), jsmath.Fijo2(ch.precio), jsmath.Fijo2(ventas.ACentavos(float64(ch.cantidad*ch.precio)))); err != nil {
				return err
			}
			if ch.antes.variante == nil || ch.cantidad == ch.antes.cantidad {
				continue
			}
			delta := ventas.UnidadesDeStock(ch.cantidad-ch.antes.cantidad, ch.antes.factor)
			if delta < 0 {
				enReserva, err := reservas.ReservasDelRenglon(ctx, tx, ch.id)
				if err != nil {
					return err
				}
				if err := reservas.BloquearEnOrden(ctx, tx, enReserva); err != nil {
					return err
				}
				if _, _, err := reservas.ReducirReserva(ctx, tx, ch.id, -delta); err != nil {
					return err
				}
				continue
			}
			suc, ok, err := reservas.SucursalDeSalida(ctx, tx, pedido, nil)
			if err != nil {
				return err
			}
			if ok {
				if err := reservas.VolverAReservar(ctx, tx, []reservas.ReservaDeVuelta{{OrderID: pedido, OrderItemID: ch.id,
					VariantID: *ch.antes.variante, BranchID: suc, Cantidad: delta}}); err != nil {
					return err
				}
			}
		}
		total := ventas.ACentavos(subtotal + nuevoEnvio - descuento)
		viejo := jsmath.Numero(p.total)
		if _, err := tx.Exec(ctx, `UPDATE orders SET subtotal = $2::numeric, costo_envio = $3::numeric, total = $4::numeric,
			dejado_de_cobrar = $5::numeric, updated_at = now() WHERE id = $1`,
			pedido, jsmath.Fijo2(subtotal), jsmath.Fijo2(nuevoEnvio), jsmath.Fijo2(total), jsmath.Fijo2(d.Total)); err != nil {
			return err
		}
		if dif := ventas.ACentavos(total - viejo); aCuenta && math.Abs(dif) > 0.005 && p.customerID != nil {
			if _, err := tx.Exec(ctx, `INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
				VALUES ($1, 'compra', $2::numeric, $3, $4, $5)`, *p.customerID, jsmath.Fijo2(dif), "Corrección del pedido "+p.numero, p.numero, ses.UserID); err != nil {
				return err
			}
		}
		cambios = strings.Join(notas, " · ")
		nota := "Corregido: " + cambios + " · " + c.Motivo
		if autorizo != "" {
			nota += " · autorizó " + autorizo
		}
		_, err = tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, $2, $3, $4)`,
			pedido, p.estado, nota, ses.UserID)
		return err
	})
	if err != nil {
		return nil, err
	}
	var detalle any
	if autorizo != "" {
		detalle = map[string]any{"autorizadoPor": autorizo}
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaEditar, "pedido", pedido, "Corrigió "+numero+": "+cambios+" · "+c.Motivo, detalle)
	return &Resultado{Ok: numero + " corregido.", Numero: numero}, nil
}
