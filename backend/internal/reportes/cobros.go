package reportes

import (
	"context"
	"math"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
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
//     esa factura no tiene cobros propios de antes de los recibos (los de
//     invoice_payments sin recibo, que ya se asientan solos). Lo que se le
//     cobró con un recibo no cuenta: el recibo se asienta aparte, y con eso
//     la venta mixta del mostrador cuya parte a cuenta corriente se cobraba
//     después desde Facturación perdía hacia atrás el cobro con tarjeta, y
//     Deudores quedaba debiendo esa parte para siempre (también en meses ya
//     entregados). La fecha es la del cobro o, si la
//     factura salió después, la de la factura: así un mes ya cerrado no
//     cambia porque se facture tarde. Una venta sin factura no tiene asiento
//     de venta, así que tampoco de cobro. También entran los pagos de deuda
//     de antes de los recibos.
//
// Los reintegros (el pago reintegrado, la venta del mostrador anulada, los
// tramos de un reintegro parcial en payment_refunds) son el cobro al revés.

// reciboAAsentar es un recibo del período con sus partes.
type reciboAAsentar struct {
	id, numero, cliente string
	emitido             time.Time
	anulado             *time.Time
	partes              []ParteDeRecibo
}

func recibos2partes(rs []*reciboAAsentar) map[string]*[]ParteDeRecibo {
	out := make(map[string]*[]ParteDeRecibo, len(rs))
	for _, r := range rs {
		out[r.id] = &r.partes
	}
	return out
}

// retencionesPorImpuesto parte la «retencion» de cada recibo en las de cada
// impuesto (retenciones_sufridas del recibo), así cada una va a la cuenta de
// su impuesto. Si no suman lo mismo que la parte (un recibo viejo, una carga
// a mano), la parte queda entera y va a Retenciones sufridas.
func (s *Servicio) retencionesPorImpuesto(ctx context.Context, partes map[string]*[]ParteDeRecibo) error {
	if len(partes) == 0 {
		return nil
	}
	ids := make([]string, 0, len(partes))
	for id := range partes {
		ids = append(ids, id)
	}
	rs, err := s.pool.Query(ctx, `SELECT receipt_id::text, impuesto::text, sum(importe)::float8 FROM retenciones_sufridas
		WHERE receipt_id = ANY($1::uuid[]) GROUP BY receipt_id, impuesto ORDER BY receipt_id, impuesto`, ids)
	if err != nil {
		return err
	}
	defer rs.Close()
	porRecibo := map[string][]ParteDeRecibo{}
	for rs.Next() {
		var id, impuesto string
		var importe float64
		if err := rs.Scan(&id, &impuesto, &importe); err != nil {
			return err
		}
		porRecibo[id] = append(porRecibo[id], ParteDeRecibo{Medio: "retencion", Importe: importe, Impuesto: impuesto})
	}
	if err := rs.Err(); err != nil {
		return err
	}
	for id, sufridas := range porRecibo {
		ps := partes[id]
		var enParte, enSufridas float64
		var resto []ParteDeRecibo
		for _, p := range *ps {
			if p.Medio == "retencion" {
				enParte = float64(enParte + p.Importe)
			} else {
				resto = append(resto, p)
			}
		}
		for _, p := range sufridas {
			enSufridas = float64(enSufridas + p.Importe)
		}
		if math.Abs(enParte-enSufridas) > toleranciaAsiento {
			continue
		}
		*ps = append(sufridas, resto...)
	}
	return nil
}

func mayorFecha(a time.Time, b *time.Time) time.Time {
	if b != nil && b.After(a) {
		return *b
	}
	return a
}

func entre(t, desde, hasta time.Time) bool { return !t.Before(desde) && !t.After(hasta) }

// repartoHasta recorre las cuentas hasta `hasta` (cobros.RepartirCobros).
// Solo lee: los recibos de antes que no tienen el reparto fijado se calculan
// con la misma regla que los fijaría (cobros.FijarRepartosDeAntes, el
// comando «mjbj repartos»), pero no se guardan. Mirar el cierre es un GET.
//
// La vista del cierre pide a la vez los pendientes y los asientos de los dos
// circuitos, y los tres reparten hasta el mismo instante: el que llega
// mientras otro ya está calculando espera ese mismo cálculo (compartido) en
// vez de hacer el suyo. **El resultado es de todos los que lo esperaron:
// nadie lo puede modificar** (CalcularAging copia antes de ordenar,
// CsvDeudores ordena sus propias claves). No se guarda nada después: el que
// llega cuando terminó reparte de nuevo, con los hechos de ese momento.
func (s *Servicio) repartoHasta(ctx context.Context, hasta time.Time) (cobros.ResultadoDelReparto, error) {
	return compartido(ctx, &s.repartos, strconv.FormatInt(hasta.UnixNano(), 10), func(c context.Context) (cobros.ResultadoDelReparto, error) {
		return s.cargarReparto(c, hasta)
	})
}

// cargarReparto lee los eventos por el pool de los reportes, en una
// transacción de solo lectura: apaga el JIT y fuerza el plan a medida
// (cobros.PlanDelReparto), y es REPEATABLE READ porque CargarEventos son dos
// consultas (los eventos y los pendientes de los recibos) que tienen que ver
// la misma foto de la base. Reparte afuera, con la conexión ya devuelta: el
// pool de los reportes tiene cuatro.
func (s *Servicio) cargarReparto(ctx context.Context, hasta time.Time) (cobros.ResultadoDelReparto, error) {
	var ev []cobros.EventoDeCuenta
	err := pgx.BeginTxFunc(ctx, s.lectura, pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}, func(tx pgx.Tx) error {
		if _, err := cobros.PlanDelReparto(ctx, tx); err != nil {
			return err
		}
		if s.alCargarReparto != nil {
			if err := s.alCargarReparto(ctx, tx); err != nil {
				return err
			}
		}
		var err error
		ev, err = cobros.CargarEventos(ctx, tx, hasta, "")
		return err
	})
	if err != nil {
		return cobros.ResultadoDelReparto{}, err
	}
	return cobros.RepartirCobros(ev), nil
}

// compartido corre f una sola vez para todos los que piden la misma clave
// mientras está en curso. f corre con un contexto propio: si el primero que
// llegó se va (cambió de mes, cerró la pestaña), los demás siguen esperando
// el mismo cálculo y no reciben su «context canceled». Pero cuando se va el
// último, el cálculo se cancela: la clave es el instante, cada mes es un
// cálculo distinto, y el contador que pasa de octubre a julio con las
// flechas dejaba cuatro repartos sin nadie que los esperara, cada uno con
// una de las cuatro conexiones del pool de los reportes, y el mes que de
// verdad miraba esperaba a que se liberaran. El tope deja pasar el minuto
// por sentencia de ese pool.
func compartido[T any](ctx context.Context, g *grupo, clave string, f func(context.Context) (T, error)) (T, error) {
	g.mu.Lock()
	if g.en == nil {
		g.en = map[string]*llamada{}
	}
	l, ok := g.en[clave]
	if !ok {
		c, cancelar := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		l = &llamada{cancelar: cancelar, listo: make(chan struct{})}
		g.en[clave] = l
		go func() {
			defer close(l.listo)
			defer cancelar()
			v, err := f(c)
			g.mu.Lock()
			l.val, l.err = v, err
			if g.en[clave] == l {
				delete(g.en, clave)
			}
			g.mu.Unlock()
		}()
	}
	l.esperan++
	g.mu.Unlock()

	var cero T
	select {
	case <-l.listo:
		if l.err != nil {
			return cero, l.err
		}
		return l.val.(T), nil
	case <-ctx.Done():
		g.mu.Lock()
		l.esperan--
		if l.esperan == 0 {
			l.cancelar()
			// El que llegue después no se suma a un cálculo cancelado.
			if g.en[clave] == l {
				delete(g.en, clave)
			}
		}
		g.mu.Unlock()
		return cero, ctx.Err()
	}
}

// grupo son los cálculos en curso de compartido, por clave.
type grupo struct {
	mu sync.Mutex
	en map[string]*llamada
}

type llamada struct {
	esperan  int
	cancelar context.CancelFunc
	listo    chan struct{}
	val      any
	err      error
}

// asientosDeCobro son los cobros del período, con idesde/ihasta ya en el
// mes argentino (son instantes), y el reparto hasta ihasta.
//
// Los recibos se asientan con su reparto entre los circuitos
// (cobros.Reparto): lo que cancela facturas con CAE contra Deudores, la seña
// contra Anticipos de clientes y lo que paga ventas sin factura en el
// circuito B. Cuando sale la factura de una seña, el anticipo se le aplica.
func (s *Servicio) asientosDeCobro(ctx context.Context, idesde, ihasta time.Time, reparto cobros.ResultadoDelReparto) ([]Asiento, error) {
	asientos := []Asiento{}
	for _, ap := range reparto.Aplicaciones {
		if !entre(ap.Fecha, idesde, ihasta) {
			continue
		}
		e := ap.Evento
		concepto := "Aplica anticipo · " + NombreComprobante(e.TipoComprobante) + " " + NumeroFormateado(e.PuntoVenta, e.Numero) + " · " + e.Cliente
		if ap.Importe < 0 {
			concepto = "Desaplica anticipo · anulación del recibo " + e.Cliente
		}
		asientos = append(asientos, AsientoDeAplicacion(ap.Fecha, concepto, ap.Importe))
	}

	// 1. Los cobros de una factura de antes de los recibos.
	rs, err := s.lectura.Query(ctx, `
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
	rs, err = s.lectura.Query(ctx, `
		SELECT r.id, r.numero, r.recibido_de, r.created_at, r.anulado_at, p.medio::text, p.importe, coalesce(ch.circuito = 'negro', false)
		FROM receipts r JOIN receipt_parts p ON p.receipt_id = r.id LEFT JOIN cheques ch ON ch.id = p.cheque_id
		WHERE (r.created_at >= $1 AND r.created_at <= $2) OR (r.anulado_at >= $1 AND r.anulado_at <= $2)
		ORDER BY r.created_at, r.id, p.orden`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	var recibos []*reciboAAsentar
	porID := map[string]*reciboAAsentar{}
	for rs.Next() {
		var id, numero, cliente, medio string
		var emitido time.Time
		var anulado *time.Time
		var importe jsmath.Num
		var negro bool
		if err := rs.Scan(&id, &numero, &cliente, &emitido, &anulado, &medio, &importe, &negro); err != nil {
			rs.Close()
			return nil, err
		}
		r, ok := porID[id]
		if !ok {
			r = &reciboAAsentar{id: id, numero: numero, cliente: cliente, emitido: emitido, anulado: anulado}
			porID[id] = r
			recibos = append(recibos, r)
		}
		r.partes = append(r.partes, ParteDeRecibo{Medio: medio, Importe: importe.F(), Negro: negro})
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}
	if err := s.retencionesPorImpuesto(ctx, recibos2partes(recibos)); err != nil {
		return nil, err
	}
	for _, r := range recibos {
		// El reparto (CargarEventos de todas las cuentas) ve todo recibo
		// hasta ihasta, como último recurso con la clave «r:», y toda
		// anulación hasta ihasta. Lo que no ve se hizo después de su foto de
		// la base: entre que se leyó y esta consulta, una ventana que el
		// reparto compartido estira a lo que tarda (1,5 s con la base
		// fijada). Se deja para la próxima lectura, igual que lo deja el
		// reparto: asentarlo sin él descuadraba el mes en curso (el recibo
		// sin reparto, o la anulación sin su «Desaplica anticipo» y fuera de
		// reparto.Deudores, que encendía «El listado de deudores no da el
		// mayor»). Antes era un error que había que reintentar.
		rep, ok := reparto.Recibos[r.id]
		if !ok {
			continue
		}
		if r.anulado != nil && !reparto.Anulados[r.id] {
			r.anulado = nil
		}
		if entre(r.emitido, idesde, ihasta) {
			asientos = append(asientos, AsientosDeRecibo(ReciboAAsentar{Fecha: r.emitido, Numero: r.numero, Cliente: r.cliente,
				Partes: r.partes, Reparto: &rep})...)
		}
		// La anulación, con el mismo reparto al revés.
		if r.anulado != nil && entre(*r.anulado, idesde, ihasta) {
			asientos = append(asientos, AsientosDeRecibo(ReciboAAsentar{Fecha: *r.anulado, Numero: r.numero, Cliente: r.cliente,
				Partes: r.partes, Anulacion: true, Reparto: &rep})...)
		}
	}

	// 3. El tramo de un reintegro parcial de un pago con recibo: solo el que
	// devolvió deuda a la cuenta (con movimiento), igual que la cuenta. Vuelve
	// a cada circuito en la proporción del reparto del recibo.
	rs, err = s.lectura.Query(ctx, `
		SELECT f.created_at, f.importe, r.numero, r.recibido_de, x.medio::text, r.id
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
		var numero, cliente, medio, recibo string
		if err := rs.Scan(&fecha, &importe, &numero, &cliente, &medio, &recibo); err != nil {
			rs.Close()
			return nil, err
		}
		c := CobroAAsentar{Fecha: fecha, Comprobante: "parcial del recibo " + numero, Cliente: cliente, Importe: importe.F(), Medio: medio}
		rep, ok := reparto.Recibos[recibo]
		if !ok {
			asientos = append(asientos, AsientoDeReintegro(c))
			continue
		}
		asientos = append(asientos, AsientosDeTramo(c, cobros.TramoPorCircuito(rep, importe.F()))...)
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	// 3b. Lo que una devolución de la venta le devolvió a un recibo
	// (receipt_refunds): por caja o por el banco, con el reparto del recibo,
	// como el tramo de arriba. Sin esto la nota de crédito acreditaba
	// Deudores, la caja tenía la salida y el CSV no tenía el reintegro.
	rs, err = s.lectura.Query(ctx, `
		SELECT t.created_at, t.importe, r.numero, r.recibido_de, t.medio::text, r.id, `+cobros.ReintegroDeLoFacturado+`
		FROM receipt_refunds t JOIN receipts r ON r.id = t.receipt_id
		WHERE t.created_at >= $1 AND t.created_at <= $2
		ORDER BY t.created_at, t.id`, idesde, ihasta)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var fecha time.Time
		var importe jsmath.Num
		var numero, cliente, medio, recibo string
		var facturado bool
		if err := rs.Scan(&fecha, &importe, &numero, &cliente, &medio, &recibo, &facturado); err != nil {
			rs.Close()
			return nil, err
		}
		// Lo que no vuelve en efectivo vuelve por el banco, aunque se haya
		// cobrado con un cheque: ese cheque ya no está en Valores a depositar.
		if medio != "efectivo" {
			medio = "transferencia"
		}
		c := CobroAAsentar{Fecha: fecha, Comprobante: "por devolución del recibo " + numero, Cliente: cliente, Importe: importe.F(), Medio: medio}
		// Lo devuelto de una factura con CAE vuelve entero al blanco, contra
		// la nota de crédito (cobros.ReintegroDeLoFacturado); lo demás, con el
		// reparto del recibo.
		rep, ok := reparto.Recibos[recibo]
		if facturado || !ok {
			asientos = append(asientos, AsientoDeReintegro(c))
			continue
		}
		asientos = append(asientos, AsientosDeTramo(c, cobros.TramoPorCircuito(rep, importe.F()))...)
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return nil, err
	}

	// 4. Los pagos sin recibo: la venta del mostrador y el pedido en línea
	// facturados, y la deuda pagada antes de los recibos. Qué cae en el
	// período (el cobro, el reintegro o un tramo) se decide en Go, con la
	// fecha corrida a la de la factura.
	rs, err = s.lectura.Query(ctx, `
		SELECT p.id, p.tipo::text, coalesce(p.medio, ''), p.monto, p.estado::text, p.updated_at,
		       coalesce(p.acreditado_at, CASE WHEN p.proveedor = 'mostrador' THEN coalesce(o.cobrada_at, o.created_at) END,
		                p.conciliado_at, p.created_at),
		       f.fecha_emision, f.tipo, f.punto_venta, f.numero, o.numero,
		       coalesce(f.receptor_nombre, nullif(c.razon_social, ''), c.nombre, o.contacto_nombre, ''),
		       coalesce((SELECT json_agg(json_build_object('fecha', `+cobros.FechaDelTramo("x")+`, 'importe', x.importe::float8,
		                                           'devolucion', x.devolucion_id IS NOT NULL) ORDER BY x.created_at)
		                 FROM payment_refunds x WHERE x.payment_id = p.id), '[]'::json)
		FROM payments p
		LEFT JOIN orders o ON o.id = p.order_id
		LEFT JOIN customers c ON c.id = p.customer_id
		LEFT JOIN LATERAL (
		  SELECT i.id, i.fecha_emision, i.tipo::text AS tipo, i.punto_venta, i.numero, i.receptor_nombre FROM invoices i
		  WHERE i.order_id = p.order_id AND i.tipo::text LIKE 'factura%' AND i.estado <> 'borrador' AND i.cae IS NOT NULL
		    AND i.cae_ambiente IS DISTINCT FROM 'homologacion'
		  ORDER BY (i.estado = 'anulada'), i.fecha_emision LIMIT 1) f ON true
		WHERE p.estado IN ('aprobado', 'reintegrado')
		  AND NOT EXISTS (SELECT 1 FROM receipt_parts x WHERE x.payment_id = p.id)
		  AND ((p.tipo = 'pedido' AND f.id IS NOT NULL
		        AND NOT EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.invoice_id = f.id AND ip.medio <> 'cuenta_corriente'
		                          AND ip.receipt_id IS NULL))
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
			// Devolucion: el tramo lo dejó una devolución de la venta y no un
			// aviso de Mercado Pago.
			Devolucion bool `json:"devolucion"`
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
				// Lo que una devolución saca de un cobro con cheque vuelve por el
				// banco: el cheque sigue en cartera (en Valores a depositar) y
				// se deposita entero. La misma regla que la 3b.
				if t.Devolucion && (medio == "cheque" || medio == "echeq") {
					r.Medio = "transferencia"
				}
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
	for i := range asientos {
		asientos[i].Instante = true
	}
	return asientos, nil
}
