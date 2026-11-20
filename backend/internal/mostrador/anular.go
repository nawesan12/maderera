package mostrador

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/autorizacion"
	"mjbj/internal/caja"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/reservas"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
	"mjbj/internal/zodjs"
)

// ResultadoAnulacion es anularVentaDeMostrador: el motivo si no se pudo, y
// la factura que quedó esperando su nota de crédito.
type ResultadoAnulacion struct {
	Ok               bool
	Error            string
	FacturaPendiente *string
	// FacturaSinCAE: la pendiente no tiene CAE, y sin CAE no hay nota de
	// crédito posible (no hay nada que acreditar ante ARCA): se da de baja.
	FacturaSinCAE bool
	Numero        string
	// Autorizacion: hace falta el PIN de un admin.
	Autorizacion *Autorizacion
	// AutorizadoPor: el admin que la autorizó (con su PIN o su sesión).
	AutorizadoPor string
	Total         float64
	// PorAfuera es lo que falta devolver por el posnet o el banco: lo cobrado
	// con tarjeta o transferencia menos lo que ya devolvieron las
	// devoluciones por afuera. El cheque en cartera vuelve en mano.
	PorAfuera float64
}

// PedidoDeAnulacion es lo que llega para anular.
type PedidoDeAnulacion struct {
	Motivo string
	// VolvioLaMercaderia: false si el cliente se la llevó. El stock no vuelve
	// (antes volvía siempre, y el faltante aparecía recién en el inventario).
	VolvioLaMercaderia bool
	PIN, Ficha         string
}

// minutosParaCorregir: una venta propia recién hecha con tarjeta o
// transferencia se anula sin PIN (se cargó mal y el cliente sigue ahí). Con
// efectivo o cuenta corriente, no: ver firmaParaAnular.
const minutosParaCorregir = 5 * time.Minute

// Anular es anularVentaDeMostrador: **nada se borra, todo se revierte.** El
// pedido queda cancelado, el stock vuelve con un movimiento de devolución
// (o se libera la reserva del acopio), la caja recibe un movimiento negativo,
// la deuda se cancela con otro asiento, los cheques en cartera se anulan y el
// corte que no se cortó se cae. El comprobante fiscal no se toca: se avisa.
//
// **Quién anula sin PIN** (T3, hallazgo 8). Antes cualquier vendedor anulaba
// cualquier venta, de cualquier día y de cualquier vendedor: cobrar en
// efectivo, anular, guardarse la plata y «volvió la mercadería» era el robo
// clásico, y el faltante aparecía recién en el inventario. Ahora:
//
//   - Un admin anula siempre (su sesión es la firma).
//   - Un vendedor, sin PIN, solo una venta suya, de hoy, del turno abierto
//     de su sucursal, de hace menos de cinco minutos y que **no movió
//     efectivo ni deuda**: tarjeta, transferencia, Mercado Pago, cheque. Esa
//     devolución se ve en el banco.
//   - Efectivo o cuenta corriente piden el PIN siempre (revisión de T3): con
//     la ventana de cinco minutos, cobrar en efectivo, dejar ir al cliente y
//     anular con «Volvió» a los tres minutos seguía siendo el robo clásico,
//     solo que apurado; y una venta a cuenta corriente contaba como «sin
//     cobrar» y se anulaba sin PIN en todo el turno, borrando la deuda.
//   - «Se la llevó» (la mercadería no vuelve) pide el PIN siempre.
//   - Todo lo demás pide el PIN de un admin.
//
// Todo lo que puede rechazar va antes de la primera escritura.
func (s *Servicio) Anular(ctx context.Context, ses *auth.Sesion, pedido string, a PedidoDeAnulacion) (ResultadoAnulacion, error) {
	motivo := zodjs.TrimJS(a.Motivo)
	if motivo == "" {
		return ResultadoAnulacion{Error: "Poné el motivo: una anulación sin explicación no se puede revisar después."}, nil
	}
	firma, falta, err := s.firmaParaAnular(ctx, ses, pedido, a)
	if err != nil || falta != nil {
		return ResultadoAnulacion{Autorizacion: falta, Error: mensajeDeFalta(falta)}, err
	}
	var autorizadoPor *string
	if firma != nil {
		autorizadoPor = &firma.UserID
	}
	var r ResultadoAnulacion
	err = plataforma.EnTransaccion(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		r, err = anularEnTransaccion(ctx, tx, pedido, motivo, ses.UserID, a.VolvioLaMercaderia, autorizadoPor)
		if err == nil && !r.Ok {
			return errSinEscribir
		}
		return err
	})
	if errors.Is(err, errSinEscribir) {
		return r, nil
	}
	if firma != nil {
		r.AutorizadoPor = firma.Nombre
	}
	return r, err
}

func mensajeDeFalta(a *Autorizacion) string {
	if a == nil {
		return ""
	}
	f := autorizacion.Falta{PinIncorrecto: a.PinIncorrecto, BloqueadoHasta: a.BloqueadoHasta, SinAdmins: a.SinAdmins}
	return f.Mensaje()
}

// firmaParaAnular decide si la anulación pide PIN y, si lo pide, lo prueba.
// Devuelve la firma (nil si no hizo falta) o lo que falta.
func (s *Servicio) firmaParaAnular(ctx context.Context, ses *auth.Sesion, pedido string, a PedidoDeAnulacion) (*autorizacion.Firma, *Autorizacion, error) {
	var p struct {
		total            jsmath.Num
		sucursal, vendio *string
		creada           time.Time
		// cajonODeuda: la venta metió efectivo en el cajón o deuda en la
		// cuenta (o es una vieja sin detalle de pagos y no se sabe).
		cajonODeuda bool
		enElTurno   bool
		// noSeAnula: ya anulada o no es del mostrador. Lo dice la
		// transacción; pedir un PIN para eso es llamar al admin para
		// nada.
		noSeAnula bool
	}
	err := s.pool.QueryRow(ctx, `
		SELECT o.total, o.branch_id, o.created_by_user_id, o.created_at,
		       coalesce((SELECT sum(importe) FROM order_payments WHERE order_id = o.id AND medio IN ('efectivo', 'cuenta_corriente')), 0) > 0
		         OR (NOT EXISTS (SELECT 1 FROM order_payments WHERE order_id = o.id)
		             AND (o.medio_pago IS NULL OR o.medio_pago IN ('efectivo', 'cuenta_corriente'))),
		       EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.branch_id = o.branch_id AND cs.estado = 'abierta' AND cs.abierta_at <= o.created_at),
		       o.estado = 'cancelado' OR o.origen <> 'mostrador'
		FROM orders o WHERE o.id::text = $1`, pedido).
		Scan(&p.total, &p.sucursal, &p.vendio, &p.creada, &p.cajonODeuda, &p.enElTurno, &p.noSeAnula)
	if errors.Is(err, pgx.ErrNoRows) {
		// El «no encontramos la venta» lo dice la transacción.
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	if ses.Tiene(sqlc.StaffRoleAdmin) {
		return &autorizacion.Firma{UserID: ses.UserID, Nombre: ses.Nombre}, nil, nil
	}
	if p.noSeAnula {
		return nil, nil, nil
	}
	propia := p.vendio != nil && *p.vendio == ses.UserID
	ahora := s.ahora()
	reciente := ahora.Sub(p.creada) < minutosParaCorregir
	// De hoy, en el día argentino: una caja que quedó abierta de un día para
	// el otro no vuelve «del turno» a las ventas de ayer.
	deHoy := p.creada.In(caja.Argentina).Format(time.DateOnly) == ahora.In(caja.Argentina).Format(time.DateOnly)
	if a.VolvioLaMercaderia && propia && p.enElTurno && deHoy && reciente && !p.cajonODeuda {
		return nil, nil, nil
	}
	sucursal := ""
	if p.sucursal != nil {
		sucursal = *p.sucursal
	}
	firma, err := s.aut.Exigir(ctx, ses, autorizacion.Pedido{Motivo: autorizacion.Anular, Monto: p.total.F(), Clave: pedido,
		Sucursal: sucursal, PIN: a.PIN, Ficha: a.Ficha})
	var falta *autorizacion.Falta
	if errors.As(err, &falta) {
		return nil, faltaDeAutorizacion(falta).Autorizacion, nil
	}
	return firma, nil, err
}

func anularEnTransaccion(ctx context.Context, tx pgx.Tx, id, motivo, usuario string, volvio bool, autorizadoPor *string) (ResultadoAnulacion, error) {
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

	// Cómo se pagó de verdad: order_payments, o el medio único de las viejas.
	type renglon struct {
		medio   string
		importe jsmath.Num
	}
	var detalle []renglon
	filas, err := tx.Query(ctx, `SELECT medio::text, importe FROM order_payments WHERE order_id = $1`, id)
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
	// Lo que ya devolvieron las devoluciones parciales no vuelve otra vez.
	// Cada una sale por el medio por el que entró y con ese tope
	// (facturacion.DevolucionParcial), así que restar por medio alcanza; el
	// piso en cero es por las dudas.
	var porCaja, porCuenta float64
	if err := tx.QueryRow(ctx, `SELECT coalesce(sum(importe) FILTER (WHERE destino = 'caja'), 0)::float8,
		coalesce(sum(importe) FILTER (WHERE destino = 'cuenta'), 0)::float8 FROM devoluciones WHERE order_id = $1`, id).
		Scan(&porCaja, &porCuenta); err != nil {
		return ResultadoAnulacion{}, err
	}
	parteEfectivo = jsmath.Redondear2(max(0, parteEfectivo-porCaja))
	parteCuenta = jsmath.Redondear2(max(0, parteCuenta-porCuenta))

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

	// Si una devolución por afuera ya sacó plata del cobro con cheque, anular
	// le devolvería además el cheque entero: el cliente cobraba dos veces. Lo
	// que cierra es devolver el resto con otra devolución por afuera (el
	// cheque se deposita entero y al cliente le vuelve todo por el banco);
	// desde Cheques no hay cómo devolver una parte. Va antes de la primera
	// escritura, como todo lo que rechaza esta función.
	var chequeTocado bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM payment_refunds t JOIN payments p ON p.id = t.payment_id
		WHERE p.order_id = $1 AND p.medio = $2 AND t.devolucion_id IS NOT NULL)`, id, ventas.Cheque).Scan(&chequeTocado); err != nil {
		return ResultadoAnulacion{}, err
	}
	if chequeTocado {
		return no("Parte del cheque de esta venta ya se devolvió por afuera: devolvé el resto desde la factura.")
	}

	// Lo que el cajero devuelve por el posnet o el banco, antes de que los
	// cobros pasen a reintegrado: sin restar los tramos de las devoluciones
	// por afuera, el resultado decía el total y se devolvía otra vez lo que
	// ya había salido.
	var porAfuera float64
	if err := tx.QueryRow(ctx, `SELECT coalesce(sum(p.monto - coalesce((SELECT sum(t.importe) FROM payment_refunds t WHERE t.payment_id = p.id), 0)), 0)::float8
		FROM payments p WHERE p.order_id = $1 AND p.estado = 'aprobado' AND coalesce(p.medio, '') NOT IN ($2, $3, $4)`,
		id, ventas.Efectivo, ventas.CuentaCorriente, ventas.Cheque).Scan(&porAfuera); err != nil {
		return ResultadoAnulacion{}, err
	}

	var conRetiro bool
	if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM deliveries WHERE order_id = $1 AND estado <> 'anulada')`, id).Scan(&conRetiro); err != nil {
		return ResultadoAnulacion{}, err
	}
	if conRetiro {
		return no("Esta venta ya tiene retiros con remito. Anulá o revisá las entregas desde la ficha del pedido.")
	}

	var sesion *string
	if parteEfectivo > 0 && p.sucursal != nil {
		var turno string
		// FOR SHARE: el cierre del turno espera a que la devolución confirme
		// (y si cerró primero, el turno ya no está abierto y no se elige).
		err := tx.QueryRow(ctx, `SELECT id FROM cash_sessions WHERE branch_id = $1 AND estado = 'abierta' LIMIT 1 FOR SHARE`, *p.sucursal).Scan(&turno)
		if errors.Is(err, pgx.ErrNoRows) {
			return no("La venta fue en efectivo y no hay caja abierta. Abrí la caja para poder devolver la plata.")
		}
		if err != nil {
			return ResultadoAnulacion{}, err
		}
		sesion = &turno
	}

	// 1. El stock: vuelve lo que de verdad salió del físico y se libera lo
	// que sigue reservado. Las dos cosas pueden pasar en la misma venta (un
	// acopio con un remito anulado) o ninguna. Si el cliente se la llevó, el
	// físico no vuelve: solo se liberan las reservas.
	if err := devolverLoQueSalio(ctx, tx, id, p.numero, usuario, volvio); err != nil {
		return ResultadoAnulacion{}, err
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
	if !volvio {
		notas = append(notas, "La mercadería no volvió.")
	}
	if _, err := tx.Exec(ctx, `UPDATE orders SET estado = 'cancelado', estado_pago = 'reintegrado', notas = $2, updated_at = now(),
		anulacion_autorizada_por = $3, mercaderia_no_volvio = $4 WHERE id = $1`,
		id, strings.Join(notas, "\n"), autorizadoPor, !volvio); err != nil {
		return ResultadoAnulacion{}, err
	}
	// El momento de la anulación queda en el historial: el cierre Z muestra
	// la devolución en el turno en que se hizo (caja.CierresDeTurnos), y la
	// venta sigue en el Z de su turno.
	if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, 'cancelado', $2, $3)`,
		id, "Anulada en el mostrador: "+motivo, usuario); err != nil {
		return ResultadoAnulacion{}, err
	}

	// El trabajo de corte que todavía no se cortó se cae con la venta.
	if _, err := tx.Exec(ctx, `UPDATE cutting_orders SET estado = 'cancelado', updated_at = now() WHERE order_id = $1 AND estado IN ('en-cola', 'en-proceso')`, id); err != nil {
		return ResultadoAnulacion{}, err
	}

	var factura struct {
		id     string
		estado string
		sinCAE bool
	}
	err = tx.QueryRow(ctx, `SELECT id, estado::text, cae IS NULL FROM invoices WHERE order_id = $1 LIMIT 1`, id).Scan(&factura.id, &factura.estado, &factura.sinCAE)
	r := ResultadoAnulacion{Ok: true, Numero: p.numero, Total: total, PorAfuera: jsmath.Redondear2(max(0, porAfuera))}
	if err == nil && factura.estado != "anulada" {
		r.FacturaPendiente = &factura.id
		r.FacturaSinCAE = factura.sinCAE
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return ResultadoAnulacion{}, err
	}
	return r, nil
}

// devolverLoQueSalio devuelve al físico lo que la venta sacó y todavía no
// volvió, y libera sus reservas activas.
//
// **Arreglado**: se decidía por la ausencia de reservas («sin reservas, todo
// salió con la venta»). Un acopio con el remito anulado se quedaba sin
// reservas con la mercadería en el galpón, y anular la venta la devolvía
// otra vez: el físico subía de la nada. Ahora se suman los movimientos de la
// venta («Mostrador V-…»), de sus remitos («Remito REM-…» y su anulación) y
// de sus devoluciones parciales (por id, no por el texto de la nota), por
// variante: vuelve lo que falte, a las sucursales de donde salió.
//
// Por variante y no por sucursal: una devolución que entró por otra
// sucursal ya devolvió parte de lo que salió de la de la venta, y sumado por
// sucursal se devolvía dos veces.
//
// Con devolverFisico en false (el cliente se llevó la mercadería) solo se
// liberan las reservas: el stock no vuelve.
func devolverLoQueSalio(ctx context.Context, tx pgx.Tx, pedido, numero, usuario string, devolverFisico bool) error {
	filas, err := tx.Query(ctx, `
		SELECT variant_id, branch_id, (-sum(qty))::text FROM inventory_movements
		WHERE variant_id IN (SELECT variant_id FROM order_items WHERE order_id = $1 AND variant_id IS NOT NULL)
		  AND type IN ('venta', 'devolucion')
		  AND (note = $2
		       OR note IN (SELECT 'Remito ' || numero FROM deliveries WHERE order_id = $1)
		       OR note IN (SELECT 'Anulación del remito ' || numero FROM deliveries WHERE order_id = $1)
		       OR (documento_tipo = 'devolucion' AND documento_id IN (SELECT id FROM devoluciones WHERE order_id = $1)))
		GROUP BY variant_id, branch_id ORDER BY variant_id, branch_id`, pedido, "Mostrador "+numero)
	if err != nil {
		return err
	}
	var netos []reservas.LineaDevuelta
	for filas.Next() {
		var l reservas.LineaDevuelta
		var cantidad string
		if err := filas.Scan(&l.VariantID, &l.BranchID, &cantidad); err != nil {
			filas.Close()
			return err
		}
		l.Cantidad = ventas.CantidadDeStock(jsmath.Numero(cantidad))
		netos = append(netos, l)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return err
	}
	var vueltas []reservas.LineaDevuelta
	if devolverFisico {
		vueltas = LoQueFaltaDevolver(netos)
	}
	var stocks []reservas.Stock
	for _, l := range vueltas {
		stocks = append(stocks, reservas.Stock{Variante: l.VariantID, Sucursal: l.BranchID})
	}
	filas, err = tx.Query(ctx, `SELECT variant_id, branch_id FROM stock_reservations WHERE order_id = $1 AND estado = 'activa'`, pedido)
	if err != nil {
		return err
	}
	for filas.Next() {
		var s reservas.Stock
		if err := filas.Scan(&s.Variante, &s.Sucursal); err != nil {
			filas.Close()
			return err
		}
		stocks = append(stocks, s)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return err
	}
	// Todos los candados juntos y en orden: liberar y devolver por separado
	// los tomarían en dos tandas.
	if err := reservas.BloquearEnOrden(ctx, tx, stocks); err != nil {
		return err
	}
	if err := reservas.LiberarReservas(ctx, tx, pedido); err != nil {
		return err
	}
	for _, x := range vueltas {
		if _, err := tx.Exec(ctx, `UPDATE inventory SET qty = qty + $3::numeric, updated_at = now() WHERE variant_id = $1 AND branch_id = $2`,
			x.VariantID, x.BranchID, jsmath.Texto(x.Cantidad)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id)
			VALUES ($1, $2, 'devolucion', $3::numeric, $4, $5)`, x.VariantID, x.BranchID, jsmath.Texto(x.Cantidad), "Anulación "+numero, usuario); err != nil {
			return err
		}
	}
	return nil
}

// LoQueFaltaDevolver recibe, por variante y sucursal, lo que salió neto
// (negativo: entró más de lo que salió, una devolución por otra sucursal) y
// devuelve lo que vuelve a cada sucursal de salida: por variante, lo que
// sobró en otras sucursales se descuenta de las de salida, en orden.
func LoQueFaltaDevolver(netos []reservas.LineaDevuelta) []reservas.LineaDevuelta {
	sobra := map[string]float64{}
	for _, l := range netos {
		if l.Cantidad < 0 {
			sobra[l.VariantID] += -l.Cantidad
		}
	}
	var out []reservas.LineaDevuelta
	for _, l := range netos {
		if l.Cantidad <= 0 {
			continue
		}
		descuento := min(l.Cantidad, sobra[l.VariantID])
		sobra[l.VariantID] -= descuento
		if c := ventas.CantidadDeStock(l.Cantidad - descuento); c > 0 {
			out = append(out, reservas.LineaDevuelta{VariantID: l.VariantID, BranchID: l.BranchID, Cantidad: c})
		}
	}
	return out
}
