package checkout

import (
	"context"
	"errors"
	"math"
	"net/http"
	"sort"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cortes"
	"mjbj/internal/cuentas"
	"mjbj/internal/jsmath"
	"mjbj/internal/limites"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/profesionales"
	"mjbj/internal/reservas"
	"mjbj/internal/ventas"
)

func espera(v limites.Veredicto) error {
	return plataforma.NuevoProblema(http.StatusTooManyRequests, limites.AvisoDeEspera(v))
}

// clientePorCorreo es la ficha con ese correo, si hay.
func (s *Servicio) clientePorCorreo(ctx context.Context, email string) (*string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT id FROM customers WHERE email = $1 LIMIT 1`, email).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &id, err
}

// --- app/(public)/carrito/actions.ts ---

// Presupuesto es lo que contesta pedirPresupuesto.
type Presupuesto struct {
	Ok      string `json:"ok"`
	Numero  string `json:"numero"`
	Express bool   `json:"express"`
	QuoteID string `json:"quoteId"`
}

// DiasDeValidez de un presupuesto pedido desde el sitio.
const DiasDeValidez = 15

// PedirPresupuesto convierte el carrito en un presupuesto con número y los
// precios del momento. El carrito no se vacía. El correo lo manda Next
// (notificarPresupuestoRecibido) con el id que se devuelve.
func (s *Servicio) PedirPresupuesto(ctx context.Context, q Quien, ip string, m map[string]any) (*Presupuesto, error) {
	d, e := LeerPedidoDePresupuesto(m)
	if e != nil {
		return nil, fallo(e.Mensaje)
	}
	if v := s.lim.PorAmbos(ctx, limites.Presupuesto, ip, "correo", d.Email); !v.Permitido {
		return nil, espera(v)
	}
	carrito, err := s.Obtener(ctx, q)
	if err != nil {
		return nil, err
	}
	if carrito.ID == nil || len(carrito.Items) == 0 {
		return nil, fallo("Agregá al menos un producto antes de pedir el presupuesto.")
	}
	prof, err := profesionales.Nuevo(s.pool, nil, "", s.log).Estado(ctx, q.Ses)
	if err != nil {
		return nil, err
	}
	cliente := prof.CustomerID
	if cliente == nil {
		if cliente, err = s.clientePorCorreo(ctx, d.Email); err != nil {
			return nil, err
		}
	}
	express := prof.Aprobado
	ahora := s.ahora()
	origen, responde := "sitio", VencimientoDelDia(ahora)
	if express {
		origen, responde = "express", VencimientoExpress(ahora)
	}
	var usuario *string
	if q.Ses != nil {
		usuario = &q.Ses.UserID
	}
	p := &Presupuesto{Express: express}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		numero, err := numeracion.Presupuesto(ctx, tx, ahora.In(argentina))
		if err != nil {
			return err
		}
		p.Numero = numero
		subtotal := jsmath.Fijo2(carrito.Subtotal)
		if err := tx.QueryRow(ctx, `
			INSERT INTO quotes (numero, customer_id, contacto_nombre, contacto_email, contacto_telefono, branch_id, estado, origen,
			                    subtotal, total, notas, valido_hasta, necesita_para, responde_hasta, created_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, 'pendiente', $7::origen_presupuesto, $8::numeric, $8::numeric, $9, $10, $11, $12, $13)
			RETURNING id`,
			numero, cliente, d.Nombre, d.Email, d.Telefono, d.SucursalID, origen, subtotal, NotasDelPresupuesto(d.Motivos, d.Notas),
			ahora.In(argentina).AddDate(0, 0, DiasDeValidez), d.NecesitaPara, responde, usuario).Scan(&p.QuoteID); err != nil {
			return err
		}
		for i, it := range carrito.Items {
			precio := precioDelItem(it)
			if _, err := tx.Exec(ctx, `
				INSERT INTO quote_items (quote_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, notas, orden)
				VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9)`,
				p.QuoteID, it.VariantID, it.Descripcion, it.Unidad, jsmath.Fijo2(it.Cantidad), jsmath.Fijo2(precio),
				jsmath.Fijo2(float64(precio*it.Cantidad)), it.Notas, i); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if express {
		p.Ok = "Recibimos tu pedido " + p.Numero + ". Como sos cliente profesional, te contestamos dentro de las 24 horas hábiles."
	} else {
		p.Ok = "Recibimos tu pedido " + p.Numero + ". Te contestamos a la brevedad con el presupuesto armado."
	}
	return p, nil
}

// --- app/(public)/carrito/confirmar/actions.ts ---

// Compra es el pedido creado.
type Compra struct {
	PedidoID string `json:"pedidoId"`
	Numero   string `json:"numero"`
	Token    string `json:"token"`
}

// Mensajes de confirmarCompra.
const (
	MsjVacio        = "El carrito está vacío."
	MsjSinPrecio    = "Hay productos sin precio cargado. Pedilos por WhatsApp y te pasamos la cotización."
	MsjYaConfirmado = "Este carrito ya se confirmó. Revisá tu correo: ahí está el pedido."
)

type lineaDePedido struct {
	variante     *string
	presentacion *string
	descripcion  string
	unidad       string
	cantidad     float64
	precio       float64
}

// Confirmar es confirmarCompra: crea el pedido con los precios de la base
// (nunca del formulario), los cortes a medida recalculados, el costo
// congelado, la deuda si es a cuenta corriente y la mercadería reservada,
// todo en una transacción, y desactiva el carrito.
//
// **Bloquea la fila del carrito** y verifica que siga activo: en el TS dos
// clics en «Confirmar» (o dos pestañas) creaban dos pedidos del mismo
// carrito, con la mercadería reservada dos veces.
func (s *Servicio) Confirmar(ctx context.Context, q Quien, ip string, m map[string]any) (*Compra, error) {
	d, e := LeerDatosDeCompra(m)
	if e != nil {
		return nil, fallo(e.Mensaje)
	}
	// El freno, antes de tocar nada: quema numeración y reserva stock.
	if v := s.lim.PorAmbos(ctx, limites.Comprar, ip, "correo", d.Email); !v.Permitido {
		return nil, espera(v)
	}
	carrito, err := s.Obtener(ctx, q)
	if err != nil {
		return nil, err
	}
	if carrito.ID == nil || (len(carrito.Items) == 0 && len(carrito.Cortes) == 0) {
		return nil, fallo(MsjVacio)
	}
	cartID := *carrito.ID
	lista, err := s.cat.Vigente(ctx, q.Ses)
	if err != nil {
		return nil, err
	}
	resueltos, msg, err := s.cortes.ResolverCarrito(ctx, lista, cartID)
	if err != nil {
		return nil, err
	}
	if msg != "" {
		return nil, fallo(msg)
	}
	items := make([]float64, len(carrito.Items))
	for i, it := range carrito.Items {
		items[i] = it.Subtotal
		if precioDelItem(it) <= 0 {
			return nil, fallo(MsjSinPrecio)
		}
	}
	totalesCortes := make([]float64, len(resueltos))
	for i, c := range resueltos {
		totalesCortes[i] = c.Cuenta.Total
	}
	var zona *Zona
	if d.Entrega == "envio" && d.ZonaID != nil {
		var z Zona
		var costo, gratis jsmath.Num
		err := s.pool.QueryRow(ctx, `SELECT nombre, costo, envio_gratis_desde, a_cotizar FROM shipping_zones WHERE id = $1 AND activa`,
			*d.ZonaID).Scan(&z.Nombre, &costo, &gratis, &z.ACotizar)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fallo("Esa zona de envío ya no está disponible.")
		}
		if err != nil {
			return nil, err
		}
		z.Costo, z.EnvioGratisDesde = float64(costo), float64(gratis)
		zona = &z
	}
	var cliente, usuario *string
	if q.Ses != nil {
		usuario = &q.Ses.UserID
		var id string
		err := s.pool.QueryRow(ctx, `SELECT id FROM customers WHERE user_id = $1 LIMIT 1`, q.Ses.UserID).Scan(&id)
		if err == nil {
			cliente = &id
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	if cliente == nil {
		if cliente, err = s.clientePorCorreo(ctx, d.Email); err != nil {
			return nil, err
		}
	}
	escalas, err := s.escalasDePago(ctx)
	if err != nil {
		return nil, err
	}
	cu, msj := CuentasDeLaCompra(items, totalesCortes, zona, d.MedioPago, lista.EsDiferenciada, escalas)
	if msj != "" {
		return nil, fallo(msj)
	}
	if d.MedioPago == "cuenta_corriente" {
		c, err := cuentas.CreditoDeLaSesion(ctx, s.pool, q.Ses, cu.Total)
		if err != nil {
			return nil, err
		}
		if !c.Habilitado || cliente == nil {
			if c.Motivo != nil {
				return nil, fallo(*c.Motivo)
			}
			return nil, fallo("No podemos cargar esta compra a cuenta corriente. Elegí otro medio de pago.")
		}
	}
	var vendedor *string
	if cliente != nil {
		if err := s.pool.QueryRow(ctx, `SELECT seller_id FROM customers WHERE id = $1`, *cliente).Scan(&vendedor); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}

	var lineas []lineaDePedido
	for _, it := range carrito.Items {
		lineas = append(lineas, lineaDePedido{it.VariantID, it.Presentacion, it.Descripcion, it.Unidad, it.Cantidad, precioDelItem(it)})
	}
	nItems := len(lineas)
	for _, c := range resueltos {
		for _, l := range c.Lineas {
			var pres *string
			if l.EsMaterial && c.Mitad != nil {
				p := "media_" + *c.Mitad
				pres = &p
			}
			lineas = append(lineas, lineaDePedido{l.VariantID, pres, l.Descripcion, l.Unidad, l.Cantidad, l.PrecioUnitario})
		}
	}

	compra := &Compra{}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if !s.SinCandado {
			var activo bool
			err := tx.QueryRow(ctx, `SELECT activo FROM carts WHERE id = $1 FOR UPDATE`, cartID).Scan(&activo)
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && !activo) {
				return fallo(MsjYaConfirmado)
			}
			if err != nil {
				return err
			}
		}
		numero, err := numeracion.Pedido(ctx, tx)
		if err != nil {
			return err
		}
		compra.Numero = numero
		if err := tx.QueryRow(ctx, `
			INSERT INTO orders (numero, customer_id, contacto_nombre, contacto_email, contacto_telefono, branch_id, estado, origen,
			                    tipo_entrega, direccion_entrega, zona_envio, costo_envio, subtotal, descuento, total, medio_pago,
			                    estado_pago, notas, seller_id, created_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, 'pendiente', 'tienda', $7::tipo_entrega, $8, $9, $10::numeric, $11::numeric, $12::numeric,
			        $13::numeric, $14::medio_pago, 'pendiente', $15, $16, $17)
			RETURNING id, public_token`,
			numero, cliente, d.Nombre, d.Email, d.Telefono, d.SucursalID, d.Entrega, d.Direccion, cu.NombreZona,
			jsmath.Fijo2(cu.CostoEnvio), jsmath.Fijo2(cu.Subtotal), jsmath.Fijo2(cu.Descuento), jsmath.Fijo2(cu.Total), d.MedioPago,
			d.Notas, vendedor, usuario).Scan(&compra.PedidoID, &compra.Token); err != nil {
			return err
		}
		// El costo del momento, congelado, y cuánto stock mueve cada línea.
		var variantes []string
		conPres := make([]reservas.LineaConPresentacion, len(lineas))
		for i, l := range lineas {
			if l.variante != nil {
				variantes = append(variantes, *l.variante)
			}
			conPres[i] = reservas.LineaConPresentacion{VariantID: l.variante, Presentacion: l.presentacion}
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
		for i, l := range lineas {
			var costo, alicuota *string
			if l.variante != nil {
				if c, ok := costos[*l.variante]; ok {
					costo = c.CostoUnitario
					a := c.AlicuotaIva
					alicuota = &a
				}
			}
			f := factores[i]
			desc := l.descripcion
			if i < nItems {
				desc = ventas.DescripcionConPresentacion(l.descripcion, f.Presentacion)
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal,
				                         presentacion, stock_por_unidad, costo_unitario, alicuota_iva, orden)
				VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9::numeric, $10::numeric, $11::numeric, $12)`,
				compra.PedidoID, l.variante, desc, l.unidad, jsmath.Fijo2(l.cantidad), jsmath.Fijo2(l.precio),
				jsmath.Fijo2(float64(l.precio*l.cantidad)), f.Presentacion, jsmath.Texto(f.StockPorUnidad),
				reservas.CostoPorUnidadDeVenta(costo, f.StockPorUnidad), alicuota, i); err != nil {
				return err
			}
		}
		// Cada corte abre su orden en la cola del taller, en la misma
		// transacción.
		for _, c := range resueltos {
			if err := abrirCorte(ctx, tx, c, compra.PedidoID, cliente, d, usuario); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, 'pendiente', 'Pedido hecho desde la tienda', $2)`,
			compra.PedidoID, usuario); err != nil {
			return err
		}
		if d.MedioPago == "cuenta_corriente" && cliente != nil {
			if _, err := tx.Exec(ctx, `
				INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia)
				VALUES ($1, 'compra', $2::numeric, $3, $4)`, *cliente, jsmath.Fijo2(cu.Total), "Pedido "+numero, numero); err != nil {
				return err
			}
		}
		// Los candados del stock de todas las variantes juntos y en orden:
		// reservarPedido los toma renglón por renglón, y dos compras con las
		// mismas placas en otro orden se trababan entre sí.
		if err := bloquearEnOrden(ctx, tx, d.SucursalID, variantes); err != nil {
			return err
		}
		if err := reservas.ReservarPedido(ctx, tx, compra.PedidoID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM cart_items WHERE cart_id = $1`, cartID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM cart_cortes WHERE cart_id = $1`, cartID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE carts SET activo = false, updated_at = now() WHERE id = $1`, cartID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return compra, nil
}

func bloquearEnOrden(ctx context.Context, tx pgx.Tx, sucursal *string, variantes []string) error {
	suc := ""
	if sucursal != nil {
		suc = *sucursal
	} else {
		err := tx.QueryRow(ctx, `SELECT id FROM branches WHERE active = true ORDER BY sort_order LIMIT 1`).Scan(&suc)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
	}
	unicas := map[string]bool{}
	var orden []string
	for _, v := range variantes {
		if !unicas[v] {
			unicas[v] = true
			orden = append(orden, v)
		}
	}
	sort.Strings(orden)
	for _, v := range orden {
		if err := reservas.Bloquear(ctx, tx, v, suc); err != nil {
			return err
		}
	}
	return nil
}

func entero(v float64) int32 { return int32(math.Round(v)) }

func abrirCorte(ctx context.Context, tx pgx.Tx, c cortes.CorteResuelto, pedido string, cliente *string, d DatosDeCompra, usuario *string) error {
	numero, err := numeracion.Corte(ctx, tx)
	if err != nil {
		return err
	}
	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO cutting_orders (numero, customer_id, order_id, contacto_nombre, branch_id, variant_id, material_descripcion,
		                            placa_largo_mm, placa_ancho_mm, mitad, placas, ancho_sierra_mm, pasadas, canto_descripcion,
		                            estado, notas, created_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::mitad_placa, $11, $12::numeric, $13, $14, 'en-cola', 'Pedido desde el sitio', $15)
		RETURNING id`,
		numero, cliente, pedido, d.Nombre, d.SucursalID, c.Placa.VariantID, c.Placa.Descripcion, entero(c.PlacaLargoMm),
		entero(c.PlacaAnchoMm), c.Mitad, int32(c.Placas), jsmath.Texto(c.AnchoSierraMm), int32(c.Pasadas), c.CantoDescripcion,
		usuario).Scan(&id); err != nil {
		return err
	}
	for i, p := range c.Piezas {
		if _, err := tx.Exec(ctx, `
			INSERT INTO cutting_items (cutting_order_id, largo_mm, ancho_mm, cantidad, respeta_veta, canto_largo, canto_ancho, etiqueta, orden)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			id, entero(p.LargoMm), entero(p.AnchoMm), entero(p.Cantidad), entero(p.RespetaVeta), entero(p.CantoLargo),
			entero(p.CantoAncho), p.Etiqueta, int32(i)); err != nil {
			return err
		}
	}
	return nil
}

func (s *Servicio) escalasDePago(ctx context.Context) ([]ventas.EscalaDePago, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT medio::text, desde_monto::float8, porcentaje::float8, etiqueta FROM payment_discounts WHERE activo
		ORDER BY medio, desde_monto`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (ventas.EscalaDePago, error) {
		var e ventas.EscalaDePago
		return e, r.Scan(&e.Medio, &e.DesdeMonto, &e.Porcentaje, &e.Etiqueta)
	})
}
