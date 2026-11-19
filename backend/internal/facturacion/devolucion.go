package facturacion

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"mjbj/internal/fiscal"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/reservas"
	"mjbj/internal/ventas"
)

// La devolución parcial de una venta (revisión del comité, 18/11/2026). La
// nota de crédito sola bajaba el IVA y nada más: si el cliente devolvía 2 de
// 10 placas, ni el stock, ni la caja, ni la cuenta corriente se movían. Acá
// va todo en una transacción: la nota, lo que vuelve al stock y la plata.
//
// Las reglas que no se negocian:
//
//   - **La plata vuelve por donde entró.** De la caja sale hasta lo que esa
//     venta cobró en efectivo, menos lo que ya se devolvió por caja: el que
//     paga con tarjeta no se lleva efectivo, que es el robo más viejo del
//     mostrador. A la cuenta corriente vuelve hasta lo que se cargó en ella.
//     Con eso la anulación posterior no devuelve dos veces: resta lo de cada
//     medio.
//   - **La mercadería entra a la sucursal que se elige** (la de la venta de
//     entrada): el cliente la trae a la que le queda cerca. La caja que paga
//     es la de esa misma sucursal: la plata sale del cajón que está ahí.
//   - **Lo que sigue en acopio no vuelve al galpón**: nunca salió. Se baja la
//     reserva, y el remito ya no lo entrega (entregas resta lo devuelto).
//   - **Sin `order_item_id` no hay stock.** No se adivina el renglón del
//     pedido por descripción: dos renglones iguales de variantes distintas
//     devolverían la que no era. Vuelve la plata; el stock, no.
//   - **Lo que no vuelve al stock lleva motivo de una lista** (rota, otro):
//     «se rompió» es la excusa del que se lleva plata sin devolver nada.
//   - **Una clave por intento**: el doble clic y el reintento de una
//     respuesta perdida devuelven la misma devolución, no otra.

// RenglonADevolver es cuánto de un renglón de la factura, y si vuelve al
// stock.
type RenglonADevolver struct {
	ItemID   string  `json:"itemId"`
	Cantidad float64 `json:"cantidad"`
	AlStock  bool    `json:"alStock"`
}

// PedidoDeDevolucion es lo que manda la pantalla.
type PedidoDeDevolucion struct {
	InvoiceID string
	// Clave la genera el navegador por intento (índice único).
	Clave string
	// Destino de la plata: "caja" o "cuenta".
	Destino string
	Motivo  string
	// SinStock: "rota" u "otro" si algún renglón no vuelve al stock.
	SinStock string
	// BranchID: adonde entra la mercadería y de qué caja sale la plata.
	BranchID  string
	Renglones []RenglonADevolver
}

// Devolucion es lo que quedó hecho.
type Devolucion struct {
	ID      string  `json:"id"`
	NotaID  string  `json:"notaId"`
	Importe float64 `json:"importe"`
	// Repetida: la clave ya se había usado; no se hizo nada nuevo.
	Repetida bool `json:"repetida"`
}

// Destinos de la plata de una devolución.
const (
	DevolverPorCaja   = "caja"
	DevolverPorCuenta = "cuenta"
)

// RenglonDevolvible es un renglón de la factura con lo que queda por
// devolver y si puede volver al stock.
type RenglonDevolvible struct {
	ItemID      string  `json:"itemId"`
	Descripcion string  `json:"descripcion"`
	Unidad      string  `json:"unidad"`
	Cantidad    float64 `json:"cantidad"`
	Queda       float64 `json:"queda"`
	Unitario    float64 `json:"unitario"`
	// AlStock: tiene una variante del depósito detrás.
	AlStock bool `json:"alStock"`
}

// SucursalDeDevolucion es una sucursal a la que puede entrar la mercadería.
type SucursalDeDevolucion struct {
	ID          string `json:"id"`
	Nombre      string `json:"nombre"`
	CajaAbierta bool   `json:"cajaAbierta"`
}

// DatosDeDevolucion es lo que necesita la pantalla para armar la devolución
// de una factura de venta.
type DatosDeDevolucion struct {
	Pedido    string              `json:"pedido"`
	Renglones []RenglonDevolvible `json:"renglones"`
	// Caja y Cuenta son el tope de plata por cada destino (0: no corresponde).
	Caja       float64                `json:"caja"`
	Cuenta     float64                `json:"cuenta"`
	ConCliente bool                   `json:"conCliente"`
	Sucursal   *string                `json:"sucursal"`
	Sucursales []SucursalDeDevolucion `json:"sucursales"`
}

// partesDeLaVenta es cuánto entró en efectivo y cuánto a cuenta corriente,
// menos lo que ya devolvieron las devoluciones por cada destino. Es la misma
// cuenta que mostrador.Anular: order_payments, o el medio único de las
// ventas viejas.
func partesDeLaVenta(ctx context.Context, c consultor, pedido string, medio *string, total float64) (caja, cuenta float64, err error) {
	var efectivo, aCuenta float64
	var renglones int
	if err := c.QueryRow(ctx, `SELECT count(*)::int,
		coalesce(sum(importe) FILTER (WHERE medio::text = $2), 0)::float8,
		coalesce(sum(importe) FILTER (WHERE medio::text = $3), 0)::float8
		FROM order_payments WHERE order_id = $1`, pedido, ventas.Efectivo, ventas.CuentaCorriente).Scan(&renglones, &efectivo, &aCuenta); err != nil {
		return 0, 0, err
	}
	if renglones == 0 && medio != nil {
		switch *medio {
		case ventas.Efectivo:
			efectivo = total
		case ventas.CuentaCorriente:
			aCuenta = total
		}
	}
	var porCaja, porCuenta float64
	if err := c.QueryRow(ctx, `SELECT coalesce(sum(importe) FILTER (WHERE destino = 'caja'), 0)::float8,
		coalesce(sum(importe) FILTER (WHERE destino = 'cuenta'), 0)::float8 FROM devoluciones WHERE order_id = $1`, pedido).
		Scan(&porCaja, &porCuenta); err != nil {
		return 0, 0, err
	}
	return jsmath.Redondear2(math.Max(0, efectivo-porCaja)), jsmath.Redondear2(math.Max(0, aCuenta-porCuenta)), nil
}

// DevueltoDeLaVenta es lo que las devoluciones ya sacaron de cada medio: la
// anulación de la venta lo resta para no devolverlo otra vez.
func DevueltoDeLaVenta(ctx context.Context, c consultor, pedido string) (caja, cuenta float64, err error) {
	err = c.QueryRow(ctx, `SELECT coalesce(sum(importe) FILTER (WHERE destino = 'caja'), 0)::float8,
		coalesce(sum(importe) FILTER (WHERE destino = 'cuenta'), 0)::float8 FROM devoluciones WHERE order_id = $1`, pedido).Scan(&caja, &cuenta)
	return caja, cuenta, err
}

type renglonDeStock struct {
	descripcion string
	orderItem   *string
	variante    *string
	factor      float64
}

func renglonesDeStock(ctx context.Context, c consultor, invoiceID string) (map[string]renglonDeStock, error) {
	filas, err := c.Query(ctx, `SELECT ii.id, ii.descripcion, ii.order_item_id, oi.variant_id, coalesce(oi.stock_por_unidad, 1)::float8
		FROM invoice_items ii LEFT JOIN order_items oi ON oi.id = ii.order_item_id WHERE ii.invoice_id = $1`, invoiceID)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := map[string]renglonDeStock{}
	for filas.Next() {
		var id string
		var r renglonDeStock
		if err := filas.Scan(&id, &r.descripcion, &r.orderItem, &r.variante, &r.factor); err != nil {
			return nil, err
		}
		out[id] = r
	}
	return out, filas.Err()
}

// ParaDevolver arma los datos de la pantalla. nil si la factura no es de
// una venta.
func (s *Servicio) ParaDevolver(ctx context.Context, invoiceID string) (*DatosDeDevolucion, error) {
	var pedido *string
	var tipo string
	err := s.pool.QueryRow(ctx, `SELECT order_id, tipo::text FROM invoices WHERE id = $1`, invoiceID).Scan(&pedido, &tipo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	if pedido == nil || !fiscal.EsFactura(tipo) {
		return nil, nil
	}
	var d DatosDeDevolucion
	var medio, cliente, sucursal *string
	var total float64
	if err := s.pool.QueryRow(ctx, `SELECT numero, medio_pago::text, customer_id, branch_id, total::float8 FROM orders WHERE id = $1`, *pedido).
		Scan(&d.Pedido, &medio, &cliente, &sucursal, &total); err != nil {
		return nil, err
	}
	d.ConCliente, d.Sucursal = cliente != nil, sucursal
	if d.Caja, d.Cuenta, err = partesDeLaVenta(ctx, s.pool, *pedido, medio, total); err != nil {
		return nil, err
	}
	if !d.ConCliente {
		d.Cuenta = 0
	}
	items, err := itemsOriginales(ctx, s.pool, invoiceID)
	if err != nil {
		return nil, err
	}
	acreditadas, err := yaAcreditado(ctx, s.pool, invoiceID)
	if err != nil {
		return nil, err
	}
	stock, err := renglonesDeStock(ctx, s.pool, invoiceID)
	if err != nil {
		return nil, err
	}
	d.Renglones = []RenglonDevolvible{}
	for _, i := range items {
		unitario := 0.0
		if i.Cantidad > 0 {
			unitario = fiscal.Redondear(i.Subtotal / i.Cantidad)
		}
		d.Renglones = append(d.Renglones, RenglonDevolvible{ItemID: i.ID, Descripcion: i.Descripcion, Unidad: i.Unidad, Cantidad: i.Cantidad,
			Queda: jsmath.Redondear2(math.Max(0, i.Cantidad-acreditadas[i.ID].cantidad)), Unitario: unitario,
			AlStock: stock[i.ID].variante != nil})
	}
	filas, err := s.pool.Query(ctx, `SELECT b.id, b.name, exists(SELECT 1 FROM cash_sessions c WHERE c.branch_id = b.id AND c.estado = 'abierta')
		FROM branches b WHERE b.active ORDER BY b.sort_order, b.name`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	d.Sucursales = []SucursalDeDevolucion{}
	for filas.Next() {
		var x SucursalDeDevolucion
		if err := filas.Scan(&x.ID, &x.Nombre, &x.CajaAbierta); err != nil {
			return nil, err
		}
		d.Sucursales = append(d.Sucursales, x)
	}
	return &d, filas.Err()
}

func validarDevolucion(p *PedidoDeDevolucion) error {
	p.Clave, p.Motivo = strings.TrimSpace(p.Clave), strings.TrimSpace(p.Motivo)
	switch {
	case p.Clave == "" || len(p.Clave) > 100:
		return errEmision("Falta la clave del intento: recargá la página.")
	case p.Destino != DevolverPorCaja && p.Destino != DevolverPorCuenta:
		return errEmision("Elegí si la plata sale de la caja o vuelve a la cuenta.")
	case plataforma.LargoJS(p.Motivo) < 4:
		return errEmision("Escribí el motivo de la devolución.")
	case p.BranchID != "" && !plataforma.UUIDValido(p.BranchID):
		return errEmision("Elegí la sucursal a la que entra.")
	}
	hay, sinStock := false, false
	for _, r := range p.Renglones {
		if math.IsNaN(r.Cantidad) || math.IsInf(r.Cantidad, 0) || r.Cantidad < 0 {
			return errEmision("Revisá las cantidades.")
		}
		if r.Cantidad > 0 {
			hay = true
			sinStock = sinStock || !r.AlStock
		}
	}
	if !hay {
		return errEmision("Poné cuánto se devuelve de cada renglón.")
	}
	if sinStock && p.SinStock != "rota" && p.SinStock != "otro" {
		return errEmision("Elegí por qué no vuelve al stock.")
	}
	if !sinStock {
		p.SinStock = ""
	}
	return nil
}

// porClave busca la devolución hecha con esa clave.
func porClave(ctx context.Context, c consultor, clave string) (*Devolucion, error) {
	var d Devolucion
	err := c.QueryRow(ctx, `SELECT id, nota_id, importe::float8 FROM devoluciones WHERE clave = $1`, clave).Scan(&d.ID, &d.NotaID, &d.Importe)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.Repetida = true
	return &d, nil
}

// DevolucionParcial hace la devolución entera en una transacción: la nota de
// crédito, el stock y la plata. Los candados, en el orden de la anulación de
// la venta (mostrador.anularEnTransaccion): el del pedido, el pedido, y
// recién después la factura. Dos devoluciones a la vez se ven una a la otra.
func (s *Servicio) DevolucionParcial(ctx context.Context, userID string, p PedidoDeDevolucion) (Devolucion, error) {
	if err := validarDevolucion(&p); err != nil {
		return Devolucion{}, err
	}
	if d, err := porClave(ctx, s.pool, p.Clave); err != nil || d != nil {
		if d != nil {
			return *d, nil
		}
		return Devolucion{}, err
	}
	var pedido *string
	err := s.pool.QueryRow(ctx, `SELECT order_id FROM invoices WHERE id = $1`, p.InvoiceID).Scan(&pedido)
	if errors.Is(err, pgx.ErrNoRows) {
		return Devolucion{}, errEmision("No encontramos el comprobante.")
	}
	if err != nil {
		return Devolucion{}, err
	}
	if pedido == nil {
		return Devolucion{}, errEmision("Ese comprobante no es de una venta: usá Nota de crédito.")
	}
	var out Devolucion
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		out, err = s.devolverEnTransaccion(ctx, tx, *pedido, userID, p)
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "devoluciones_clave_idx" {
		// Otro pedido con la misma clave ganó la carrera: es esta misma.
		if d, err := porClave(ctx, s.pool, p.Clave); err != nil || d != nil {
			if d != nil {
				return *d, nil
			}
			return Devolucion{}, err
		}
	}
	if err != nil {
		return Devolucion{}, s.comoEmision(err, "fiscal.devolucion", "No se pudo hacer la devolución.")
	}
	return out, nil
}

func (s *Servicio) devolverEnTransaccion(ctx context.Context, tx pgx.Tx, pedido, userID string, p PedidoDeDevolucion) (Devolucion, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1::text))`, pedido); err != nil {
		return Devolucion{}, err
	}
	var venta struct {
		numero, estado string
		medio          *string
		sucursal       *string
		cliente        *string
		total          float64
	}
	if err := tx.QueryRow(ctx, `SELECT numero, estado::text, medio_pago::text, branch_id, customer_id, total::float8
		FROM orders WHERE id = $1 FOR UPDATE`, pedido).Scan(&venta.numero, &venta.estado, &venta.medio, &venta.sucursal, &venta.cliente, &venta.total); err != nil {
		return Devolucion{}, err
	}
	if venta.estado == "cancelado" {
		return Devolucion{}, errEmision("La venta está anulada: ya se devolvió todo.")
	}
	// Con el candado del pedido: si la misma clave entró mientras se
	// esperaba, es esa.
	if d, err := porClave(ctx, tx, p.Clave); err != nil || d != nil {
		if d != nil {
			return *d, nil
		}
		return Devolucion{}, err
	}
	o, err := bloquearOriginal(ctx, tx, p.InvoiceID)
	if err != nil {
		return Devolucion{}, err
	}
	if err := s.puedeLlevarNota(o); err != nil {
		return Devolucion{}, err
	}
	if !fiscal.EsFactura(o.tipo) {
		return Devolucion{}, errEmision("La devolución se hace sobre la factura de la venta.")
	}

	// Adonde entra: la elegida, o la de la venta.
	sucursal := p.BranchID
	if sucursal == "" && venta.sucursal != nil {
		sucursal = *venta.sucursal
	}
	var nombreSucursal string
	if sucursal != "" {
		err := tx.QueryRow(ctx, `SELECT name FROM branches WHERE id = $1 AND active`, sucursal).Scan(&nombreSucursal)
		if errors.Is(err, pgx.ErrNoRows) {
			return Devolucion{}, errEmision("Esa sucursal no existe o está dada de baja.")
		}
		if err != nil {
			return Devolucion{}, err
		}
	}

	// El stock: qué variante vuelve, antes de emitir nada.
	stock, err := renglonesDeStock(ctx, tx, o.id)
	if err != nil {
		return Devolucion{}, err
	}
	type vuelta struct {
		orderItem, variante string
		unidades            float64
		alStock             bool
	}
	var vueltas []vuelta
	var candados []reservas.Stock
	parciales := []fiscal.CantidadAAcreditar{}
	for _, r := range p.Renglones {
		if r.Cantidad <= 0 {
			continue
		}
		parciales = append(parciales, fiscal.CantidadAAcreditar{ItemID: r.ItemID, Cantidad: r.Cantidad})
		x, ok := stock[r.ItemID]
		if !ok {
			return Devolucion{}, errEmision("Uno de los renglones no es de esta factura.")
		}
		if r.AlStock && x.variante == nil {
			return Devolucion{}, errEmision(`"` + x.descripcion + `" no es un producto del depósito: no vuelve al stock.`)
		}
		if x.orderItem == nil || x.variante == nil {
			continue
		}
		unidades := ventas.UnidadesDeStock(r.Cantidad, x.factor)
		if r.AlStock && unidades <= 0 {
			// La plata saldría y el stock no se movería sin que nadie lo vea.
			return Devolucion{}, errEmision(`De "` + x.descripcion + `", ` + jsmath.Texto(r.Cantidad) + ` es demasiado poco para el stock.`)
		}
		if r.AlStock && sucursal == "" {
			return Devolucion{}, errEmision("Elegí la sucursal a la que entra.")
		}
		vueltas = append(vueltas, vuelta{*x.orderItem, *x.variante, unidades, r.AlStock})
		enReserva, err := reservas.ReservasDelRenglon(ctx, tx, *x.orderItem)
		if err != nil {
			return Devolucion{}, err
		}
		candados = append(candados, enReserva...)
		if r.AlStock {
			candados = append(candados, reservas.Stock{Variante: *x.variante, Sucursal: sucursal})
		}
	}

	nota, total, err := s.notaEnTransaccion(ctx, tx, o, p.Motivo, &userID, parciales, false)
	if err != nil {
		return Devolucion{}, err
	}

	// La plata: por donde entró y hasta lo que entró.
	caja, cuenta, err := partesDeLaVenta(ctx, tx, pedido, venta.medio, venta.total)
	if err != nil {
		return Devolucion{}, err
	}
	var turno string
	switch p.Destino {
	case DevolverPorCaja:
		if total > caja+0.005 {
			if caja <= 0.005 {
				return Devolucion{}, errEmision("Esta venta no se cobró en efectivo: la plata no sale de la caja.")
			}
			return Devolucion{}, errEmision("De la caja sale hasta " + formato.Moneda(caja) + ": lo que esta venta cobró en efectivo.")
		}
		if sucursal == "" {
			return Devolucion{}, errEmision("Elegí la sucursal de la caja.")
		}
		err := tx.QueryRow(ctx, `SELECT id FROM cash_sessions WHERE branch_id = $1 AND estado = 'abierta' LIMIT 1`, sucursal).Scan(&turno)
		if errors.Is(err, pgx.ErrNoRows) {
			return Devolucion{}, errEmision("No hay caja abierta en " + nombreSucursal + ".")
		}
		if err != nil {
			return Devolucion{}, err
		}
	case DevolverPorCuenta:
		if venta.cliente == nil {
			return Devolucion{}, errEmision("La venta no tiene cliente: no hay cuenta a la que acreditar.")
		}
		if total > cuenta+0.005 {
			if cuenta <= 0.005 {
				return Devolucion{}, errEmision("Esta venta no se cargó a la cuenta corriente: no se acredita ahí.")
			}
			return Devolucion{}, errEmision("A la cuenta vuelve hasta " + formato.Moneda(cuenta) + ": lo que esta venta le cargó.")
		}
	}

	var sucursalID *string
	if sucursal != "" {
		sucursalID = &sucursal
	}
	var sinStock *string
	if p.SinStock != "" {
		sinStock = &p.SinStock
	}
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO devoluciones (clave, order_id, invoice_id, nota_id, importe, destino, branch_id, sin_stock, motivo,
		created_by_user_id) VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, $10) RETURNING id`,
		p.Clave, pedido, o.id, nota, jsmath.Fijo2(total), p.Destino, sucursalID, sinStock, p.Motivo, userID).Scan(&id); err != nil {
		return Devolucion{}, err
	}

	// El stock, con todos los candados juntos y en orden. Lo que sigue
	// apartado (acopio) baja la reserva, haya vuelto al stock o no: ya no se
	// entrega. Lo que salió de verdad vuelve al físico de la sucursal elegida.
	if err := reservas.BloquearEnOrden(ctx, tx, candados); err != nil {
		return Devolucion{}, err
	}
	for _, v := range vueltas {
		bajo, err := reservas.ReducirReserva(ctx, tx, v.orderItem, v.unidades)
		if err != nil {
			return Devolucion{}, err
		}
		resto := ventas.CantidadDeStock(v.unidades - bajo)
		if !v.alStock || resto <= 0 {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO inventory (variant_id, branch_id, qty) VALUES ($1, $2, $3::numeric)
			ON CONFLICT (variant_id, branch_id) DO UPDATE SET qty = inventory.qty + excluded.qty, updated_at = now()`,
			v.variante, sucursal, jsmath.Texto(resto)); err != nil {
			return Devolucion{}, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id, documento_tipo, documento_id)
			VALUES ($1, $2, 'devolucion', $3::numeric, $4, $5, 'devolucion', $6)`,
			v.variante, sucursal, jsmath.Texto(resto), "Devolución "+venta.numero, userID, id); err != nil {
			return Devolucion{}, err
		}
	}

	// La plata.
	switch p.Destino {
	case DevolverPorCaja:
		var mov string
		if err := tx.QueryRow(ctx, `INSERT INTO cash_movements (session_id, tipo, monto, motivo, order_id, creado_por)
			VALUES ($1, 'devolucion', $2::numeric, $3, $4, $5) RETURNING id`,
			turno, jsmath.Fijo2(-total), "Devolución "+venta.numero+": "+p.Motivo, pedido, userID).Scan(&mov); err != nil {
			return Devolucion{}, err
		}
		if _, err := tx.Exec(ctx, `UPDATE devoluciones SET cash_movement_id = $2 WHERE id = $1`, id, mov); err != nil {
			return Devolucion{}, err
		}
		// El tramo devuelto del cobro en efectivo: el cierre lo asienta como
		// reintegro (Deudores contra Caja) y la anulación de la venta, si
		// llega, reintegra solo lo que queda.
		if err := tramosDelEfectivo(ctx, tx, pedido, total, "Devolución "+venta.numero); err != nil {
			return Devolucion{}, err
		}
	case DevolverPorCuenta:
		et := etiqueta(o.tipo, o.puntoVenta, o.numero)
		var mov string
		if err := tx.QueryRow(ctx, `INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
			VALUES ($1, 'nota_credito', $2::numeric, $3, $4, $5) RETURNING id`, *venta.cliente, jsmath.Fijo2(-total),
			"Devolución de la venta "+venta.numero+": "+p.Motivo, et, userID).Scan(&mov); err != nil {
			return Devolucion{}, err
		}
		if _, err := tx.Exec(ctx, `UPDATE devoluciones SET account_movement_id = $2 WHERE id = $1`, id, mov); err != nil {
			return Devolucion{}, err
		}
	}
	return Devolucion{ID: id, NotaID: nota, Importe: total}, nil
}

// tramosDelEfectivo anota lo devuelto en los cobros en efectivo de la venta
// (payment_refunds), repartido en orden mientras les quede.
func tramosDelEfectivo(ctx context.Context, tx pgx.Tx, pedido string, importe float64, referencia string) error {
	filas, err := tx.Query(ctx, `SELECT p.id, p.monto::float8, coalesce((SELECT sum(t.importe) FROM payment_refunds t WHERE t.payment_id = p.id), 0)::float8
		FROM payments p WHERE p.order_id = $1 AND p.medio = $2 AND p.estado = 'aprobado' ORDER BY p.created_at FOR UPDATE`, pedido, ventas.Efectivo)
	if err != nil {
		return err
	}
	type cobro struct {
		id              string
		monto, devuelto float64
	}
	var cobros []cobro
	for filas.Next() {
		var c cobro
		if err := filas.Scan(&c.id, &c.monto, &c.devuelto); err != nil {
			filas.Close()
			return err
		}
		cobros = append(cobros, c)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return err
	}
	falta := importe
	for _, c := range cobros {
		if falta <= 0.005 {
			break
		}
		tramo := jsmath.Redondear2(math.Min(falta, c.monto-c.devuelto))
		if tramo <= 0.005 {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO payment_refunds (payment_id, importe, acumulado, referencia) VALUES ($1, $2::numeric, $3::numeric, $4)`,
			c.id, jsmath.Fijo2(tramo), jsmath.Fijo2(jsmath.Redondear2(c.devuelto+tramo)), referencia); err != nil {
			return err
		}
		falta = jsmath.Redondear2(falta - tramo)
	}
	return nil
}
