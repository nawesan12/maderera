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
	"mjbj/internal/reglas"
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

// RenglonNuevo es un renglón que se suma al corregir (mes simulado 2: la
// corrección solo cambiaba cantidades y precios de lo que ya estaba).
type RenglonNuevo struct {
	VariantID      string  `json:"variantId"`
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       float64 `json:"cantidad"`
	PrecioUnitario float64 `json:"precioUnitario"`
}

// Correccion es lo que manda la pantalla.
type Correccion struct {
	Renglones  []RenglonCorregido
	Nuevos     []RenglonNuevo
	CostoEnvio *float64
	// Entrega: «retiro» o «envio» para cambiarla (mes simulado 2: un pedido
	// creado como retiro no pasaba a envío). Con envío, la dirección y la
	// zona; el flete va en CostoEnvio o SinCargo.
	Entrega   string
	Direccion string
	Zona      string
	SinCargo  bool
	Motivo    string
	PIN       string
	Ficha     string
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
		case p.estado == "entregado":
			// Entregado, con remitos firmados: lo que cambia va en otro pedido
			// o en una devolución, cada uno con su remito (mes simulado 2: la
			// corrección sumaba deuda sin remito y «Todo entregado» seguía).
			return fallo("Ya se entregó: lo que falta va en otro pedido, y lo que vuelve, con una devolución.")
		case p.origen == "mostrador":
			return fallo("Es una venta del mostrador: anulala desde el mostrador y volvé a cargarla.")
		}
		var facturado, cobrado bool
		var envio, descuento float64
		var aCuenta bool
		var partido *float64
		// El descuento por forma de pago (el del presupuesto pasado a pedido
		// o el de la tienda) sigue a lo que se vende: quedaba fijo y sumar un
		// renglón no lo recalculaba (PED-1132: subtotal $ 16.545 con el 10 %
		// de antes, −$ 1.234,50). Uno puesto a mano, con otro motivo, queda.
		var medio *string
		var porMedio bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM invoices f WHERE f.order_id = o.id AND f.estado NOT IN ('anulada', 'borrador')),
			       `+fragmentos.CobradoDelPedido+` > 0.005 OR `+fragmentos.PagoEnRevision+`,
			       o.costo_envio::float8, o.descuento::float8,
			       o.customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM account_movements am
			         WHERE am.customer_id = o.customer_id AND am.referencia = o.numero AND am.tipo = 'compra'),
			       o.a_cuenta::float8, o.medio_pago::text,
			       o.medio_pago IS NOT NULL AND o.a_cuenta IS NULL AND o.descuento > 0
			         AND EXISTS (SELECT 1 FROM payment_discounts pd WHERE pd.medio = o.medio_pago AND pd.etiqueta = o.descuento_motivo)
			FROM orders o WHERE o.id = $1`, pedido).Scan(&facturado, &cobrado, &envio, &descuento, &aCuenta, &partido, &medio, &porMedio); err != nil {
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
				n = append(n, formato.Importe(x.precio)+" → "+formato.Importe(precio))
			}
			notas = append(notas, x.descripcion+": "+strings.Join(n, ", "))
			x.cantidad, x.precio = cantidad, precio
		}
		// Cambiar la entrega: con envío, la dirección y el flete (la zona, de
		// la lista, propone el suyo); a retiro, sin flete. Solo antes de que
		// salga algo.
		nuevaEntrega := ""
		ent := Entrega{}
		if c.Entrega != "" && c.Entrega != p.tipoEntrega {
			if c.Entrega != "retiro" && c.Entrega != "envio" {
				return fallo("Elegí cómo se entrega.")
			}
			if p.estado == "en-camino" {
				return fallo("Ya salió en camino: la entrega no se cambia.")
			}
			var salio bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM deliveries WHERE order_id = $1 AND estado <> 'anulada')`, pedido).Scan(&salio); err != nil {
				return err
			}
			if salio {
				return fallo("Ya salió una parte con un remito: la entrega no se cambia.")
			}
			nuevaEntrega = c.Entrega
			if c.Entrega == "envio" {
				ent = Entrega{Envio: true, Direccion: c.Direccion, Zona: c.Zona, SinCargo: c.SinCargo}
				if c.CostoEnvio != nil {
					ent.CostoEnvio, ent.ConCosto = *c.CostoEnvio, true
				}
				if err := ent.revisar(); err != nil {
					return err
				}
				if err := fleteDeLaZona(ctx, tx, &ent); err != nil {
					return err
				}
				v := ent.CostoEnvio
				c.CostoEnvio = &v
				notas = append(notas, "Entrega: se lo llevamos a "+strings.TrimSpace(c.Direccion))
			} else {
				cero := 0.0
				c.CostoEnvio = &cero
				notas = append(notas, "Entrega: lo retira")
			}
		}
		nuevoEnvio := envio
		if c.CostoEnvio != nil && ventas.ACentavos(*c.CostoEnvio) != envio {
			nuevoEnvio = ventas.ACentavos(*c.CostoEnvio)
			notas = append(notas, "Flete: "+formato.Importe(envio)+" → "+formato.Importe(nuevoEnvio))
		}

		// Los renglones nuevos: el producto, su precio de lista (para medir
		// lo que se deja de cobrar) y lo que hace falta para el stock.
		type nuevo struct {
			RenglonNuevo
			lista    *float64
			costo    *string
			alicuota *string
			factor   float64
			pres     *string
		}
		var nuevos []nuevo
		if len(c.Nuevos) > 0 {
			conVariante := make([]precios.RenglonConVariante, len(c.Nuevos))
			for i, n := range c.Nuevos {
				n.Descripcion = strings.TrimSpace(n.Descripcion)
				if !plataforma.UUIDValido(n.VariantID) || n.Descripcion == "" {
					return fallo("Uno de los productos que se suman no existe.")
				}
				if !(n.Cantidad > 0) || math.IsInf(n.Cantidad, 0) || n.Cantidad >= 1e7 {
					return fallo(`Revisá la cantidad de "` + n.Descripcion + `".`)
				}
				if n.PrecioUnitario < 0 || math.IsNaN(n.PrecioUnitario) || math.IsInf(n.PrecioUnitario, 0) || n.PrecioUnitario >= 1e10 {
					return fallo(`Revisá el precio de "` + n.Descripcion + `".`)
				}
				if n.Unidad == "" {
					n.Unidad = "unidad"
				}
				v := n.VariantID
				conVariante[i] = precios.RenglonConVariante{VariantID: &v}
				nuevos = append(nuevos, nuevo{RenglonNuevo: n})
			}
			lista, err := precios.ListaDelCliente(ctx, tx, p.customerID)
			if err != nil {
				return err
			}
			listas, err := precios.PreciosDeLista(ctx, tx, conVariante, lista)
			if err != nil {
				return err
			}
			variantes := make([]string, len(nuevos))
			conPres := make([]reservas.LineaConPresentacion, len(nuevos))
			for i := range nuevos {
				nuevos[i].lista = listas[i]
				variantes[i] = nuevos[i].VariantID
				v := nuevos[i].VariantID
				conPres[i] = reservas.LineaConPresentacion{VariantID: &v}
			}
			costos, err := reservas.CostosParaCongelar(ctx, tx, variantes)
			if err != nil {
				return err
			}
			factores, err := reservas.FactoresDeStock(ctx, tx, conPres)
			if errors.Is(err, ventas.ErrSinMedidas) {
				return fallo(err.Error())
			}
			if err != nil {
				return err
			}
			for i := range nuevos {
				if c, ok := costos[nuevos[i].VariantID]; ok {
					nuevos[i].costo = c.CostoUnitario
					a := c.AlicuotaIva
					nuevos[i].alicuota = &a
				}
				nuevos[i].factor, nuevos[i].pres = factores[i].StockPorUnidad, factores[i].Presentacion
				notas = append(notas, "Suma "+jsmath.Texto(ventas.CantidadDeStock(nuevos[i].Cantidad))+" "+nuevos[i].Descripcion)
			}
		}
		if len(notas) == 0 {
			return fallo("No cambió nada.")
		}

		// Lo que se deja de cobrar contra la lista, como en el mostrador.
		renglones := make([]ventas.LineaDeVenta, 0, len(orden)+len(nuevos))
		for _, id := range orden {
			x := items[id]
			l := ventas.LineaDeVenta{VariantID: x.variante, Cantidad: x.cantidad, PrecioUnitario: x.precio}
			if x.precioLista != nil {
				v := jsmath.Numero(*x.precioLista)
				l.PrecioLista = &v
			}
			renglones = append(renglones, l)
		}
		for _, n := range nuevos {
			v := n.VariantID
			renglones = append(renglones, ventas.LineaDeVenta{VariantID: &v, Cantidad: ventas.CantidadDeStock(n.Cantidad),
				PrecioUnitario: ventas.ACentavos(n.PrecioUnitario), PrecioLista: n.lista})
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
		// Sobre qué va el descuento por forma de pago: lo del catálogo, y con
		// la regla descuento_al_flete también lo cargado a mano (como al
		// pasar el presupuesto a pedido).
		alFlete := porMedio && reglas.Es(ctx, tx, reglas.DescuentoAlFlete, "si")
		var base float64
		for _, id := range orden {
			sub := ventas.ACentavos(float64(items[id].cantidad * items[id].precio))
			subtotal = ventas.ACentavos(subtotal + sub)
			if items[id].variante != nil || alFlete {
				base = ventas.ACentavos(base + sub)
			}
		}
		var ultimoOrden int
		if err := tx.QueryRow(ctx, `SELECT coalesce(max(orden), 0) FROM order_items WHERE order_id = $1`, pedido).Scan(&ultimoOrden); err != nil {
			return err
		}
		for i, n := range nuevos {
			cantidad, precio := ventas.CantidadDeStock(n.Cantidad), ventas.ACentavos(n.PrecioUnitario)
			sub := ventas.ACentavos(float64(cantidad * precio))
			subtotal = ventas.ACentavos(subtotal + sub)
			// Lo que se suma es del catálogo: entra siempre.
			base = ventas.ACentavos(base + sub)
			var item string
			if err := tx.QueryRow(ctx, `
				INSERT INTO order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal,
				                         presentacion, stock_por_unidad, costo_unitario, alicuota_iva, orden, precio_lista)
				VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9::numeric, $10::numeric, $11::numeric, $12, $13::numeric)
				RETURNING id::text`,
				pedido, n.VariantID, n.Descripcion, n.Unidad, jsmath.Fijo2(cantidad), jsmath.Fijo2(precio), jsmath.Fijo2(sub), n.pres,
				jsmath.Texto(n.factor), reservas.CostoPorUnidadDeVenta(n.costo, n.factor), n.alicuota, ultimoOrden+1+i, fijo2ONulo(n.lista)).Scan(&item); err != nil {
				return err
			}
			suc, ok, err := reservas.SucursalDeSalida(ctx, tx, pedido, nil)
			if err != nil {
				return err
			}
			if ok {
				if err := reservas.VolverAReservar(ctx, tx, []reservas.ReservaDeVuelta{{OrderID: pedido, OrderItemID: item,
					VariantID: n.VariantID, BranchID: suc, Cantidad: ventas.UnidadesDeStock(cantidad, n.factor)}}); err != nil {
					return err
				}
			}
		}
		if nuevaEntrega != "" {
			var direccion, zona *string
			if nuevaEntrega == "envio" {
				d := strings.TrimSpace(ent.Direccion)
				direccion = &d
				if z := strings.TrimSpace(ent.Zona); z != "" {
					zona = &z
				}
			}
			if _, err := tx.Exec(ctx, `UPDATE orders SET tipo_entrega = $2::tipo_entrega, direccion_entrega = $3, zona_envio = $4 WHERE id = $1`,
				pedido, nuevaEntrega, direccion, zona); err != nil {
				return err
			}
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
		if porMedio && medio != nil {
			esc, err := s.q.WithTx(tx).EscalasDePago(ctx)
			if err != nil {
				return err
			}
			escalas := make([]ventas.EscalaDePago, len(esc))
			for i, f := range esc {
				escalas[i] = ventas.EscalaDePago{Medio: string(f.Medio), DesdeMonto: f.DesdeMonto.F(), Porcentaje: f.Porcentaje.F(), Etiqueta: f.Etiqueta}
			}
			nuevo, motivo := 0.0, (*string)(nil)
			if e := ventas.DescuentoPorMedioDePago(escalas, *medio, base); e != nil {
				nuevo = ventas.MontoDelDescuentoDePago(base, e.Porcentaje)
				if e.Etiqueta != "" {
					m := e.Etiqueta
					motivo = &m
				}
			}
			if nuevo != descuento {
				notas = append(notas, "Descuento: "+formato.Importe(descuento)+" → "+formato.Importe(nuevo))
				descuento = nuevo
				if _, err := tx.Exec(ctx, `UPDATE orders SET descuento = $2::numeric, descuento_motivo = CASE WHEN $2::numeric > 0 THEN $3 END WHERE id = $1`,
					pedido, jsmath.Fijo2(descuento), motivo); err != nil {
					return err
				}
			}
		}
		total := ventas.ACentavos(subtotal + nuevoEnvio - descuento)
		viejo := jsmath.Numero(p.total)
		// «Sin cargo» a propósito (mes 23): el pedido que pasa a envío lo
		// elige o no; un flete con plata lo apaga; si no, queda como estaba.
		sinCargo := "flete_sin_cargo AND $3::numeric = 0"
		switch {
		case nuevaEntrega == "envio" && ent.SinCargo && !ent.ConCosto:
			sinCargo = "$3::numeric = 0"
		case nuevaEntrega != "":
			sinCargo = "false"
		}
		if _, err := tx.Exec(ctx, `UPDATE orders SET subtotal = $2::numeric, costo_envio = $3::numeric, total = $4::numeric,
			dejado_de_cobrar = $5::numeric, flete_sin_cargo = `+sinCargo+`, updated_at = now() WHERE id = $1`,
			pedido, jsmath.Fijo2(subtotal), jsmath.Fijo2(nuevoEnvio), jsmath.Fijo2(total), jsmath.Fijo2(d.Total)); err != nil {
			return err
		}
		dif := ventas.ACentavos(total - viejo)
		// El pedido partido (H047): la corrección cambia el resto, que se
		// cobra aparte; la parte de la cuenta solo baja si el total nuevo
		// queda por debajo de ella.
		if partido != nil {
			dif = 0
			if total < *partido-0.005 {
				dif = ventas.ACentavos(total - *partido)
				if _, err := tx.Exec(ctx, `UPDATE orders SET a_cuenta = nullif(greatest($2::numeric, 0), 0) WHERE id = $1`, pedido, jsmath.Fijo2(total)); err != nil {
					return err
				}
			}
		}
		if aCuenta && math.Abs(dif) > 0.005 && p.customerID != nil {
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
