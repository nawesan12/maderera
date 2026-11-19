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
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/reservas"
	"mjbj/internal/ventas"
	"mjbj/internal/ventas/fragmentos"
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
//     Lo cobrado con tarjeta, transferencia, Mercado Pago o cheque vuelve
//     «por afuera»: la nota y el stock se hacen, la devolución queda anotada
//     con su importe y la caja no se toca (el reintegro lo hace el posnet o
//     el banco). Con eso la anulación posterior no devuelve dos veces: resta
//     lo de cada medio.
//   - **La mercadería entra a la sucursal que se elige** (la de la venta de
//     entrada): el cliente la trae a la que le queda cerca. La caja que paga
//     es la de esa misma sucursal: la plata sale del cajón que está ahí.
//   - **De cada renglón se dice cuánto sale del acopio y cuánto trae el
//     cliente.** Lo del acopio baja la reserva (nunca salió del galpón y el
//     remito ya no lo entrega); lo que trae vuelve al físico. Antes se bajaba
//     primero la reserva: el que traía 2 de las que ya se había llevado
//     perdía 2 de las que le quedaban por retirar.
//   - **Lo que no vuelve al stock deja rastro.** Lo que trae roto entra y sale
//     en el mismo acto (devolución y ajuste): la anulación posterior de la
//     venta cuenta que volvió y no lo suma otra vez al físico. Lo que se rompió
//     en el galpón baja la reserva y el físico. Y lleva motivo de una lista
//     (rota, otro): «se rompió» es la excusa del que se lleva plata sin
//     devolver nada.
//   - **Sin `order_item_id` no hay stock.** No se adivina el renglón del
//     pedido por descripción después de facturar (la 00134 emparejó las
//     facturas de antes como lo hace la emisión, y dejó afuera lo ambiguo).
//     Vuelve la plata; el stock, no, y no hay motivo que pedir.
//   - **Lo que se confirma es lo que sale.** La pantalla pide el importe a
//     Go (CalcularDevolucion: con la percepción y el resto exacto del renglón
//     que se cierra) y lo manda de vuelta; si cambió, no se hace.
//   - **Un CAE de prueba no lleva nota en producción.** La venta facturada en
//     homologación antes de encender ARCA se devuelve igual: stock y plata,
//     sin comprobante (el original nunca valió ante el fisco).
//   - **Una clave por intento**: el doble clic y el reintento de una
//     respuesta perdida devuelven la misma devolución, no otra.

// RenglonADevolver es cuánto de un renglón de la factura, y si vuelve al
// stock.
type RenglonADevolver struct {
	ItemID   string  `json:"itemId"`
	Cantidad float64 `json:"cantidad"`
	AlStock  bool    `json:"alStock"`
	// DelAcopio es cuánto de Cantidad sale de lo que sigue apartado; el
	// resto lo trae el cliente. nil: todo lo que se pueda del acopio, que es
	// lo único posible cuando el renglón está entero en acopio o entero
	// entregado (con las dos cosas a la vez hay que decirlo).
	DelAcopio *float64 `json:"delAcopio"`
}

// PedidoDeDevolucion es lo que manda la pantalla.
type PedidoDeDevolucion struct {
	InvoiceID string
	// Clave la genera el navegador por intento (índice único).
	Clave string
	// Destino de la plata: "caja", "cuenta", "afuera" o "deuda".
	Destino string
	Motivo  string
	// SinStock: "rota" u "otro" si algún renglón con producto no vuelve al
	// stock.
	SinStock string
	// BranchID: adonde entra la mercadería y de qué caja sale la plata.
	BranchID  string
	Renglones []RenglonADevolver
	// Importe es lo que la persona confirmó (nil: no se controla).
	Importe *float64
}

// Devolucion es lo que quedó hecho.
type Devolucion struct {
	ID string `json:"id"`
	// NotaID es "" si no lleva nota (un CAE de prueba con ARCA en
	// producción).
	NotaID  string  `json:"notaId"`
	Importe float64 `json:"importe"`
	// Repetida: la clave ya se había usado; no se hizo nada nuevo.
	Repetida bool `json:"repetida"`
}

// Destinos de la plata de una devolución. «deuda» no mueve plata: lo
// devuelto no se había cobrado, y baja lo que se debe del pedido.
const (
	DevolverPorCaja   = "caja"
	DevolverPorCuenta = "cuenta"
	DevolverPorAfuera = "afuera"
	DevolverLaDeuda   = "deuda"
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
	// EnAcopio es cuánto de Queda sigue apartado (en la unidad de la
	// factura); el resto ya se lo llevó el cliente.
	EnAcopio float64 `json:"enAcopio"`
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
	// Caja, Cuenta y Afuera son el tope de plata por cada destino (0: no
	// corresponde). Deuda es lo que falta cobrar: lo que se devuelve sin
	// que salga plata.
	Caja       float64                `json:"caja"`
	Cuenta     float64                `json:"cuenta"`
	Afuera     float64                `json:"afuera"`
	Deuda      float64                `json:"deuda"`
	ConCliente bool                   `json:"conCliente"`
	Sucursal   *string                `json:"sucursal"`
	Sucursales []SucursalDeDevolucion `json:"sucursales"`
	// VentaAnulada: ya no hay nada que devolver; la factura se anula.
	VentaAnulada bool `json:"ventaAnulada"`
}

// topesDeLaVenta es cuánto de la venta entró por cada camino de vuelta, y
// cuánto se debe todavía (deuda: lo que se puede devolver sin que salga
// plata).
type topesDeLaVenta struct{ caja, cuenta, afuera, deuda float64 }

// partesDeLaVenta es cuánto entró en efectivo, a cuenta corriente y por los
// demás medios, menos lo que ya devolvieron las devoluciones por cada
// destino.
//
// La venta del mostrador lo tiene en order_payments (la misma cuenta que
// mostrador.Anular). El pedido que se cobra con recibo no (comité final,
// A3): antes se tomaba su total como cobrado por el medio del pedido, y del
// pedido de presupuesto «en efectivo» sin cobrar salía efectivo de la caja
// por plata que nunca entró. Ahora es lo cobrado de verdad: las partes de
// los recibos vivos del pedido y los cobros en línea aprobados que ningún
// recibo nombra, menos lo que ya se les reintegró. Lo que no se cobró es la
// deuda: devolver eso no saca plata, baja lo que se debe. Una retención no
// vuelve por ningún lado (es un crédito fiscal con su certificado).
func partesDeLaVenta(ctx context.Context, c consultor, pedido string, medio *string, total float64) (topesDeLaVenta, error) {
	var efectivo, aCuenta, resto, deuda float64
	var renglones int
	if err := c.QueryRow(ctx, `SELECT count(*)::int,
		coalesce(sum(importe) FILTER (WHERE medio::text = $2), 0)::float8,
		coalesce(sum(importe) FILTER (WHERE medio::text = $3), 0)::float8,
		coalesce(sum(importe) FILTER (WHERE medio::text NOT IN ($2, $3)), 0)::float8
		FROM order_payments WHERE order_id = $1`, pedido, ventas.Efectivo, ventas.CuentaCorriente).Scan(&renglones, &efectivo, &aCuenta, &resto); err != nil {
		return topesDeLaVenta{}, err
	}
	if renglones == 0 {
		if medio != nil && *medio == ventas.CuentaCorriente {
			// La deuda del pedido está en la cuenta corriente: vuelve ahí.
			aCuenta = total
		} else {
			if err := c.QueryRow(ctx, `
				SELECT coalesce(sum(x.importe) FILTER (WHERE x.medio = 'efectivo'), 0)::float8,
				       coalesce(sum(x.importe) FILTER (WHERE x.medio <> 'efectivo'), 0)::float8,
				       (SELECT greatest(`+fragmentos.ACobrarDelPedido+` - `+fragmentos.CobradoDelPedido+`, 0) FROM orders o WHERE o.id = $1)::float8
				FROM (
				  SELECT rp.medio::text AS medio, rp.importe FROM receipt_parts rp JOIN receipts r ON r.id = rp.receipt_id
				  WHERE r.order_id = $1 AND r.estado = 'emitido' AND rp.medio <> 'retencion'
				  UNION ALL
				  SELECT CASE WHEN p.medio = 'efectivo' THEN 'efectivo' ELSE 'otro' END,
				         p.monto - coalesce((SELECT sum(t.importe) FROM payment_refunds t WHERE t.payment_id = p.id), 0)
				  FROM payments p WHERE p.order_id = $1 AND p.estado = 'aprobado'
				    AND NOT EXISTS (SELECT 1 FROM receipt_parts x WHERE x.payment_id = p.id)
				) x`, pedido).Scan(&efectivo, &resto, &deuda); err != nil {
				return topesDeLaVenta{}, err
			}
			// Lo que ya volvió de los recibos por una devolución anterior
			// está en devoluciones (abajo): no se resta dos veces.
		}
	}
	var porCaja, porCuenta, porAfuera float64
	if err := c.QueryRow(ctx, `SELECT coalesce(sum(importe) FILTER (WHERE destino = 'caja'), 0)::float8,
		coalesce(sum(importe) FILTER (WHERE destino = 'cuenta'), 0)::float8,
		coalesce(sum(importe) FILTER (WHERE destino = 'afuera'), 0)::float8 FROM devoluciones WHERE order_id = $1`, pedido).
		Scan(&porCaja, &porCuenta, &porAfuera); err != nil {
		return topesDeLaVenta{}, err
	}
	r := jsmath.Redondear2
	// La deuda ya viene neta de las devoluciones «deuda» (ACobrarDelPedido).
	return topesDeLaVenta{r(math.Max(0, efectivo-porCaja)), r(math.Max(0, aCuenta-porCuenta)), r(math.Max(0, resto-porAfuera)),
		r(math.Max(0, deuda))}, nil
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
	// reservado es lo apartado hoy para el renglón del pedido, en unidades
	// de stock.
	reservado float64
}

func renglonesDeStock(ctx context.Context, c consultor, invoiceID string) (map[string]renglonDeStock, error) {
	filas, err := c.Query(ctx, `SELECT ii.id, ii.descripcion, ii.order_item_id, oi.variant_id, coalesce(oi.stock_por_unidad, 1)::float8,
		coalesce((SELECT sum(r.cantidad) FROM stock_reservations r WHERE r.order_item_id = oi.id AND r.estado = 'activa'), 0)::float8
		FROM invoice_items ii LEFT JOIN order_items oi ON oi.id = ii.order_item_id WHERE ii.invoice_id = $1`, invoiceID)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := map[string]renglonDeStock{}
	for filas.Next() {
		var id string
		var r renglonDeStock
		if err := filas.Scan(&id, &r.descripcion, &r.orderItem, &r.variante, &r.factor, &r.reservado); err != nil {
			return nil, err
		}
		if r.factor <= 0 {
			r.factor = 1
		}
		out[id] = r
	}
	return out, filas.Err()
}

// enAcopio es cuánto de lo que queda sigue apartado, en la unidad de la
// factura.
func (r renglonDeStock) enAcopio(queda float64) float64 {
	if r.orderItem == nil || r.variante == nil {
		return 0
	}
	return math.Min(queda, ventas.CantidadDeStock(r.reservado/r.factor))
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
	if err := s.pool.QueryRow(ctx, `SELECT numero, medio_pago::text, customer_id, branch_id, total::float8, estado = 'cancelado'
		FROM orders WHERE id = $1`, *pedido).Scan(&d.Pedido, &medio, &cliente, &sucursal, &total, &d.VentaAnulada); err != nil {
		return nil, err
	}
	d.ConCliente, d.Sucursal = cliente != nil, sucursal
	topes, err := partesDeLaVenta(ctx, s.pool, *pedido, medio, total)
	if err != nil {
		return nil, err
	}
	d.Caja, d.Cuenta, d.Afuera, d.Deuda = topes.caja, topes.cuenta, topes.afuera, topes.deuda
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
		queda := jsmath.Redondear2(math.Max(0, i.Cantidad-acreditadas[i.ID].cantidad))
		d.Renglones = append(d.Renglones, RenglonDevolvible{ItemID: i.ID, Descripcion: i.Descripcion, Unidad: i.Unidad, Cantidad: i.Cantidad,
			Queda: queda, Unitario: unitario, AlStock: stock[i.ID].variante != nil, EnAcopio: stock[i.ID].enAcopio(queda)})
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

// parcialesDe son los renglones con cantidad, como los toma la nota.
func parcialesDe(renglones []RenglonADevolver) ([]fiscal.CantidadAAcreditar, error) {
	out := []fiscal.CantidadAAcreditar{}
	for _, r := range renglones {
		if math.IsNaN(r.Cantidad) || math.IsInf(r.Cantidad, 0) || r.Cantidad < 0 {
			return nil, errEmision("Revisá las cantidades.")
		}
		if r.DelAcopio != nil && (math.IsNaN(*r.DelAcopio) || *r.DelAcopio < 0 || *r.DelAcopio > r.Cantidad+1e-9) {
			return nil, errEmision("Revisá cuánto sale del acopio.")
		}
		if r.Cantidad > 0 {
			out = append(out, fiscal.CantidadAAcreditar{ItemID: r.ItemID, Cantidad: r.Cantidad})
		}
	}
	if len(out) == 0 {
		return nil, errEmision("Poné cuánto se devuelve de cada renglón.")
	}
	return out, nil
}

// CalcularDevolucion es el importe que saldría con esos renglones, el mismo
// que calcula la devolución (CalcularNota: con los tributos prorrateados y
// el resto exacto del renglón que se cierra). La pantalla lo muestra y lo
// manda al confirmar: un unitario redondeado por la cantidad, sin la
// percepción, no era lo que salía de la caja.
func (s *Servicio) CalcularDevolucion(ctx context.Context, invoiceID string, renglones []RenglonADevolver) (float64, error) {
	parciales, err := parcialesDe(renglones)
	if err != nil {
		return 0, err
	}
	var total float64
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		o, err := leerOriginal(ctx, tx, invoiceID, false)
		if err != nil {
			return err
		}
		if err := s.estadoParaNota(o); err != nil {
			return err
		}
		calc, err := calcularNota(ctx, tx, o, parciales)
		total = calc.Total
		return err
	})
	if err != nil {
		return 0, s.comoEmision(err, "fiscal.devolucion", "No se pudo calcular la devolución.")
	}
	return total, nil
}

func validarDevolucion(p *PedidoDeDevolucion) error {
	p.Clave, p.Motivo = strings.TrimSpace(p.Clave), strings.TrimSpace(p.Motivo)
	switch {
	case p.Clave == "" || len(p.Clave) > 100:
		return errEmision("Falta la clave del intento: recargá la página.")
	case p.Destino != DevolverPorCaja && p.Destino != DevolverPorCuenta && p.Destino != DevolverPorAfuera && p.Destino != DevolverLaDeuda:
		return errEmision("Elegí por dónde vuelve la plata.")
	case plataforma.LargoJS(p.Motivo) < 4:
		return errEmision("Escribí el motivo de la devolución.")
	case p.BranchID != "" && !plataforma.UUIDValido(p.BranchID):
		return errEmision("Elegí la sucursal a la que entra.")
	case p.SinStock != "" && p.SinStock != "rota" && p.SinStock != "otro":
		return errEmision("Elegí por qué no vuelve al stock.")
	case p.Importe != nil && (math.IsNaN(*p.Importe) || math.IsInf(*p.Importe, 0)):
		return errEmision("Revisá el importe.")
	}
	_, err := parcialesDe(p.Renglones)
	return err
}

// porClave busca la devolución hecha con esa clave.
func porClave(ctx context.Context, c consultor, clave string) (*Devolucion, error) {
	var d Devolucion
	var nota *string
	err := c.QueryRow(ctx, `SELECT id, nota_id, importe::float8 FROM devoluciones WHERE clave = $1`, clave).Scan(&d.ID, &nota, &d.Importe)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if nota != nil {
		d.NotaID = *nota
	}
	d.Repetida = true
	return &d, nil
}

// DevolucionParcial hace la devolución entera en una transacción: la nota de
// crédito, el stock y la plata. Los candados, en el orden del remito
// (entregas.CrearEntrega): la serie de los remitos, el del pedido, el pedido,
// y recién después la factura. Sin el de la serie, un remito que leyó el
// saldo del acopio antes de que la devolución lo bajara entregaba lo que ya
// se había devuelto en plata. Dos devoluciones a la vez se ven una a la
// otra.
//
// La nota se manda a ARCA apenas se confirma, como la factura de la venta
// (AutorizarAlEmitir): la plata ya salió y el comprobante no puede quedar
// esperando un clic. Si ARCA no la autoriza queda pendiente en su ficha,
// donde se reintenta; no se da de baja (ver bloqueoDeBaja).
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
	if !out.Repetida && out.NotaID != "" && s.env != nil && s.env.UsaArca() {
		// Lo que conteste ARCA no deshace la devolución: queda en la ficha
		// de la nota, que es adonde va la pantalla.
		if _, err := s.AutorizarAlEmitir(ctx, out.NotaID); err != nil && Mensaje(err) == "" {
			s.log.Error("autorizando la nota de la devolución", "invoiceId", out.NotaID, "error", err)
		}
	}
	return out, nil
}

func (s *Servicio) devolverEnTransaccion(ctx context.Context, tx pgx.Tx, pedido, userID string, p PedidoDeDevolucion) (Devolucion, error) {
	if err := numeracion.BloquearRemitos(ctx, tx); err != nil {
		return Devolucion{}, err
	}
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
	if err := s.estadoParaNota(o); err != nil {
		return Devolucion{}, err
	}
	sinNota := s.caeDePruebaEnProduccion(o)
	if !sinNota {
		if err := s.ambienteParaNota(o); err != nil {
			return Devolucion{}, err
		}
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

	// El stock: qué variante vuelve y de dónde, antes de emitir nada.
	stock, err := renglonesDeStock(ctx, tx, o.id)
	if err != nil {
		return Devolucion{}, err
	}
	acreditadas, err := yaAcreditado(ctx, tx, o.id)
	if err != nil {
		return Devolucion{}, err
	}
	items, err := itemsOriginales(ctx, tx, o.id)
	if err != nil {
		return Devolucion{}, err
	}
	cantidadDe := map[string]float64{}
	for _, i := range items {
		cantidadDe[i.ID] = i.Cantidad
	}
	type vuelta struct {
		item, orderItem, variante string
		cantidad, delAcopio       float64
		// unidades de stock: del acopio y las que trae el cliente.
		acopio, traidas float64
		alStock         bool
	}
	var vueltas []vuelta
	var candados []reservas.Stock
	parciales, err := parcialesDe(p.Renglones)
	if err != nil {
		return Devolucion{}, err
	}
	conMotivo := false
	for _, r := range p.Renglones {
		if r.Cantidad <= 0 {
			continue
		}
		x, ok := stock[r.ItemID]
		if !ok {
			return Devolucion{}, errEmision("Uno de los renglones no es de esta factura.")
		}
		if r.AlStock && x.variante == nil {
			return Devolucion{}, errEmision(`"` + x.descripcion + `" no es un producto del depósito: no vuelve al stock.`)
		}
		if x.orderItem == nil || x.variante == nil {
			// Sin producto detrás (un flete, un corte) no hay stock que
			// justificar.
			vueltas = append(vueltas, vuelta{item: r.ItemID, cantidad: r.Cantidad})
			continue
		}
		conMotivo = conMotivo || !r.AlStock
		queda := math.Max(0, cantidadDe[r.ItemID]-acreditadas[r.ItemID].cantidad)
		enAcopio := x.enAcopio(queda)
		delAcopio := math.Min(r.Cantidad, enAcopio)
		if r.DelAcopio != nil {
			delAcopio = *r.DelAcopio
		} else if enAcopio > 1e-9 && enAcopio < queda-1e-9 {
			// Parte en acopio y parte entregada: no se puede adivinar qué
			// trae el cliente, y suponer que sale del acopio era quitarle lo
			// que le queda por retirar.
			return Devolucion{}, errEmision(`De "` + x.descripcion + `", decí cuánto sale del acopio.`)
		}
		if delAcopio > enAcopio+1e-9 {
			return Devolucion{}, errEmision(`De "` + x.descripcion + `", en el acopio quedan ` + jsmath.Texto(enAcopio) + `.`)
		}
		traido := ventas.CantidadDeStock(r.Cantidad - delAcopio)
		if llevado := ventas.CantidadDeStock(queda - enAcopio); traido > llevado+1e-9 {
			return Devolucion{}, errEmision(`De "` + x.descripcion + `", el cliente se llevó ` + jsmath.Texto(llevado) + `: no puede traer más.`)
		}
		v := vuelta{item: r.ItemID, orderItem: *x.orderItem, variante: *x.variante, cantidad: r.Cantidad, delAcopio: delAcopio,
			acopio: ventas.UnidadesDeStock(delAcopio, x.factor), traidas: ventas.UnidadesDeStock(traido, x.factor), alStock: r.AlStock}
		if v.acopio+v.traidas <= 0 {
			// La plata saldría y el stock no se movería sin que nadie lo vea.
			return Devolucion{}, errEmision(`De "` + x.descripcion + `", ` + jsmath.Texto(r.Cantidad) + ` es demasiado poco para el stock.`)
		}
		if v.traidas > 0 && sucursal == "" {
			return Devolucion{}, errEmision("Elegí la sucursal a la que entra.")
		}
		vueltas = append(vueltas, v)
		if v.acopio > 0 {
			enReserva, err := reservas.ReservasDelRenglon(ctx, tx, v.orderItem)
			if err != nil {
				return Devolucion{}, err
			}
			candados = append(candados, enReserva...)
		}
		if v.traidas > 0 {
			candados = append(candados, reservas.Stock{Variante: v.variante, Sucursal: sucursal})
		}
	}
	if conMotivo && p.SinStock == "" {
		return Devolucion{}, errEmision("Elegí por qué no vuelve al stock.")
	}
	if !conMotivo {
		p.SinStock = ""
	}

	var nota *string
	calc, err := calcularNota(ctx, tx, o, parciales)
	if err != nil {
		return Devolucion{}, err
	}
	total := calc.Total
	if p.Importe != nil && math.Abs(total-*p.Importe) > 0.005 {
		return Devolucion{}, errEmision("El importe cambió a " + formato.Moneda(total) + ": revisalo y confirmá de nuevo.")
	}

	// La plata: por donde entró y hasta lo que entró. Antes de emitir: un
	// rechazo acá no puede costar un número de la serie.
	topes, err := partesDeLaVenta(ctx, tx, pedido, venta.medio, venta.total)
	if err != nil {
		return Devolucion{}, err
	}
	var turno string
	switch p.Destino {
	case DevolverPorCaja:
		if total > topes.caja+0.005 {
			if topes.caja <= 0.005 {
				return Devolucion{}, errEmision("Esta venta no se cobró en efectivo: la plata no sale de la caja.")
			}
			return Devolucion{}, errEmision("De la caja sale hasta " + formato.Moneda(topes.caja) + ": lo que esta venta cobró en efectivo.")
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
		if total > topes.cuenta+0.005 {
			if topes.cuenta <= 0.005 {
				return Devolucion{}, errEmision("Esta venta no se cargó a la cuenta corriente: no se acredita ahí.")
			}
			return Devolucion{}, errEmision("A la cuenta vuelve hasta " + formato.Moneda(topes.cuenta) + ": lo que esta venta le cargó.")
		}
	case DevolverPorAfuera:
		if total > topes.afuera+0.005 {
			if topes.afuera <= 0.005 {
				return Devolucion{}, errEmision("Esta venta no se cobró con tarjeta, transferencia ni cheque.")
			}
			return Devolucion{}, errEmision("Por afuera vuelve hasta " + formato.Moneda(topes.afuera) + ": lo que esta venta cobró con otros medios.")
		}
	case DevolverLaDeuda:
		if total > topes.deuda+0.005 {
			if topes.deuda <= 0.005 {
				return Devolucion{}, errEmision("Esta venta no debe nada: la plata vuelve por donde entró.")
			}
			return Devolucion{}, errEmision("De la deuda se baja hasta " + formato.Moneda(topes.deuda) + ": lo que falta cobrar.")
		}
	}

	if sinNota {
		if _, err := tx.Exec(ctx, `UPDATE invoices SET acreditado = $2::numeric, updated_at = now() WHERE id = $1`,
			o.id, jsmath.Fijo2(fiscal.Redondear(o.acreditado+total))); err != nil {
			return Devolucion{}, err
		}
	} else {
		id, err := s.emitirNota(ctx, tx, o, p.Motivo, &userID, calc, false)
		if err != nil {
			return Devolucion{}, err
		}
		nota = &id
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
	// Lo que se llevó cada renglón, según la nota.
	importeDe := map[string]float64{}
	for _, l := range calc.Lineas {
		importeDe[l.ItemOrigenID] = fiscal.Redondear(importeDe[l.ItemOrigenID] + fiscal.Redondear(float64(l.Cantidad*l.PrecioFinalUnitario)))
	}
	for _, v := range vueltas {
		var orderItem *string
		if v.orderItem != "" {
			orderItem = &v.orderItem
		}
		if _, err := tx.Exec(ctx, `INSERT INTO devolucion_items (devolucion_id, invoice_item_id, order_item_id, cantidad, del_acopio, al_stock, importe)
			VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6, $7::numeric)`, id, v.item, orderItem, jsmath.Texto(ventas.CantidadDeStock(v.cantidad)),
			jsmath.Texto(ventas.CantidadDeStock(v.delAcopio)), v.alStock && v.variante != "", jsmath.Fijo2(importeDe[v.item])); err != nil {
			return Devolucion{}, err
		}
	}

	// El stock, con todos los candados juntos y en orden. Lo del acopio baja
	// la reserva; si no vuelve al stock (se rompió en el galpón) baja también
	// el físico de donde estaba apartado. Lo que trae el cliente entra al
	// físico de la sucursal elegida; si no vuelve al stock, entra y sale en el
	// mismo acto: la anulación de la venta lo cuenta como vuelto.
	if err := reservas.BloquearEnOrden(ctx, tx, candados); err != nil {
		return Devolucion{}, err
	}
	nombre := "Devolución " + venta.numero
	movimiento := func(variante, sucursal, tipo string, cantidad float64, nota string) error {
		_, err := tx.Exec(ctx, `INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id, documento_tipo, documento_id)
			VALUES ($1, $2, $3::movement_type, $4::numeric, $5, $6, 'devolucion', $7)`, variante, sucursal, tipo, jsmath.Texto(cantidad), nota, userID, id)
		return err
	}
	fisico := func(variante, sucursal string, delta float64) error {
		_, err := tx.Exec(ctx, `INSERT INTO inventory (variant_id, branch_id, qty) VALUES ($1, $2, $3::numeric)
			ON CONFLICT (variant_id, branch_id) DO UPDATE SET qty = inventory.qty + excluded.qty, updated_at = now()`,
			variante, sucursal, jsmath.Texto(delta))
		return err
	}
	for _, v := range vueltas {
		if v.variante == "" {
			continue
		}
		traidas := v.traidas
		if v.acopio > 0 {
			bajo, bajadas, err := reservas.ReducirReserva(ctx, tx, v.orderItem, v.acopio)
			if err != nil {
				return Devolucion{}, err
			}
			// Lo que no alcanzó a bajar (un redondeo de la unidad de stock)
			// es lo que se llevó.
			if falta := ventas.CantidadDeStock(v.acopio - bajo); falta > 0 {
				if sucursal == "" {
					return Devolucion{}, errEmision("Elegí la sucursal a la que entra.")
				}
				traidas = ventas.CantidadDeStock(traidas + falta)
			}
			if !v.alStock {
				for _, b := range bajadas {
					if err := fisico(b.Variante, b.Sucursal, -b.Cantidad); err != nil {
						return Devolucion{}, err
					}
					if err := movimiento(b.Variante, b.Sucursal, "ajuste", -b.Cantidad, nombre+": no vuelve al stock ("+p.SinStock+")"); err != nil {
						return Devolucion{}, err
					}
				}
			}
		}
		if traidas <= 0 {
			continue
		}
		if err := movimiento(v.variante, sucursal, "devolucion", traidas, nombre); err != nil {
			return Devolucion{}, err
		}
		if v.alStock {
			if err := fisico(v.variante, sucursal, traidas); err != nil {
				return Devolucion{}, err
			}
		} else if err := movimiento(v.variante, sucursal, "ajuste", -traidas, nombre+": no vuelve al stock ("+p.SinStock+")"); err != nil {
			return Devolucion{}, err
		}
	}

	// La plata.
	switch p.Destino {
	case DevolverPorCaja:
		var mov string
		if err := tx.QueryRow(ctx, `INSERT INTO cash_movements (session_id, tipo, monto, motivo, order_id, creado_por)
			VALUES ($1, 'devolucion', $2::numeric, $3, $4, $5) RETURNING id`,
			turno, jsmath.Fijo2(-total), nombre+": "+p.Motivo, pedido, userID).Scan(&mov); err != nil {
			return Devolucion{}, err
		}
		if _, err := tx.Exec(ctx, `UPDATE devoluciones SET cash_movement_id = $2 WHERE id = $1`, id, mov); err != nil {
			return Devolucion{}, err
		}
		// El tramo devuelto del cobro en efectivo: el cierre lo asienta como
		// reintegro (Deudores contra Caja) y la anulación de la venta, si
		// llega, reintegra solo lo que queda.
		if err := tramosDelEfectivo(ctx, tx, pedido, id, total, nombre); err != nil {
			return Devolucion{}, err
		}
	case DevolverPorAfuera:
		// Lo que vuelve por el banco de lo cobrado con recibo: el cierre lo
		// asienta con el reparto del recibo. Lo de la venta del mostrador y lo
		// cobrado en línea lo reintegra el posnet o Mercado Pago, que avisa
		// por su lado.
		if _, err := reintegrarDeLosRecibos(ctx, tx, pedido, id, total, false); err != nil {
			return Devolucion{}, err
		}
	case DevolverPorCuenta:
		et := venta.numero
		if nota != nil {
			et = etiqueta(o.tipo, o.puntoVenta, o.numero)
		}
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
	out := Devolucion{ID: id, Importe: total}
	if nota != nil {
		out.NotaID = *nota
	}
	return out, nil
}

// tramosDelEfectivo anota lo devuelto en los cobros en efectivo de la venta,
// repartido en orden mientras les quede: primero los de la venta del
// mostrador (payments, en payment_refunds) y después las partes en efectivo
// de los recibos del pedido (receipt_refunds). El cierre asienta cada tramo
// como reintegro, y el del recibo con su reparto. Si no alcanzan es un
// descuadre y no se sigue: la caja tendría la salida y el CSV del estudio no
// tendría el reintegro (comité final, A3: antes, sin cobros anotados, se
// seguía sin anotar nada).
func tramosDelEfectivo(ctx context.Context, tx pgx.Tx, pedido, devolucion string, importe float64, referencia string) error {
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
	if falta > 0.005 {
		resto, err := reintegrarDeLosRecibos(ctx, tx, pedido, devolucion, falta, true)
		if err != nil {
			return err
		}
		falta = resto
	}
	if falta > 0.005 {
		return errEmision("Los cobros en efectivo de esta venta no alcanzan para devolver " + formato.Moneda(importe) + ": revisalos en Cobros.")
	}
	return nil
}

// reintegrarDeLosRecibos anota en receipt_refunds lo que la devolución le
// devuelve a los recibos vivos del pedido, en orden, parte por parte: en
// efectivo (por caja) o por los medios que dejan rastro en el banco (por
// afuera). No toca las partes de un cobro en línea (payment_id): su
// reintegro lo trae Mercado Pago. Con los recibos bloqueados: anular uno a
// la vez que se le devuelve dejaría la plata devuelta dos veces. Devuelve lo
// que no alcanzó.
func reintegrarDeLosRecibos(ctx context.Context, tx pgx.Tx, pedido, devolucion string, importe float64, enEfectivo bool) (float64, error) {
	// El candado de cada recibo es el de cobros.AnularRecibo (BloquearRecibo),
	// en orden, y las partes se leen recién con los candados tomados.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext(id::text)) FROM (SELECT id FROM receipts
		WHERE order_id = $1 AND estado = 'emitido' ORDER BY id) x`, pedido); err != nil {
		return 0, err
	}
	filas, err := tx.Query(ctx, `
		SELECT rp.receipt_id, rp.medio::text, sum(rp.importe)::float8
		  - coalesce((SELECT sum(t.importe) FROM receipt_refunds t WHERE t.receipt_id = rp.receipt_id AND t.medio = rp.medio), 0)::float8
		FROM receipt_parts rp JOIN receipts r ON r.id = rp.receipt_id
		WHERE r.order_id = $1 AND r.estado = 'emitido' AND rp.payment_id IS NULL
		  AND CASE WHEN $2 THEN rp.medio = 'efectivo' ELSE rp.medio NOT IN ('efectivo', 'retencion') END
		GROUP BY rp.receipt_id, rp.medio, r.created_at ORDER BY r.created_at, rp.receipt_id, rp.medio`, pedido, enEfectivo)
	if err != nil {
		return 0, err
	}
	type parte struct {
		recibo, medio string
		queda         float64
	}
	var partes []parte
	for filas.Next() {
		var x parte
		if err := filas.Scan(&x.recibo, &x.medio, &x.queda); err != nil {
			filas.Close()
			return 0, err
		}
		partes = append(partes, x)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return 0, err
	}
	falta := importe
	for _, x := range partes {
		if falta <= 0.005 {
			break
		}
		tramo := jsmath.Redondear2(math.Min(falta, x.queda))
		if tramo <= 0.005 {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO receipt_refunds (receipt_id, devolucion_id, medio, importe) VALUES ($1, $2, $3::medio_de_cobro, $4::numeric)`,
			x.recibo, devolucion, x.medio, jsmath.Fijo2(tramo)); err != nil {
			return 0, err
		}
		falta = jsmath.Redondear2(falta - tramo)
	}
	return falta, nil
}
