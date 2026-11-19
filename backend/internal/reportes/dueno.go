package reportes

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
	"mjbj/internal/jsmath"
	"mjbj/internal/ventas/fragmentos"
)

// Los números del dueño: lo que contesta el inicio del panel para el admin.
//
// El inicio mostraba presupuestos abiertos, productos a reponer y cantidad de
// clientes, que son números del vendedor y del depósito. El dueño de una
// maderera abre el panel para saber cuánto le deben, cuánto debe, qué cheques
// vencen, cuánta plata hay y cuánto gana. Cada bloque sale de las mismas
// tablas que su pantalla, para que el número del inicio y el de la pantalla
// sean siempre el mismo:
//
//   - **Me deben** es la cuenta corriente de los clientes (account_movements,
//     positivo es deuda), con lo vencido según el aging de cobros
//     (cobros.CalcularAging, los días de crédito de cada cliente): el mismo
//     cálculo que la cartera de clientes. Más lo que se entregó sin cobrar y
//     no pasó por la cuenta (fragmentos.SinCobrarDelPedido): el dueño vio «Me
//     deben $0» con mercadería entregada y sin cobrar.
//   - **Debo** es el libro de cada proveedor (supplier_movements), el mismo
//     saldo que Pagos a proveedores: ahí están el saldo inicial que vino de
//     ISIS, los ajustes a mano y la deuda que nace con el remito, que las
//     facturas solas no tienen. Lo vencido y lo de esta semana siguen
//     saliendo de las facturas (son las que tienen vencimiento), topeados por
//     el libro de cada proveedor; lo que el libro tiene por encima de sus
//     facturas es «sin factura».
//   - **Cheques de la semana**: los recibidos en cartera que ya se pueden
//     depositar o se pueden en los próximos siete días (a cobrar), y los
//     propios entregados que debitan en ese lapso (a cubrir). Los de terceros
//     endosados a un proveedor no son de nadie de acá: no cuentan.
//   - **Plata hoy**: el efectivo que tendría que haber en cada caja abierta
//     (la suma de los movimientos del turno, como el arqueo), lo cobrado hoy
//     que va al banco, a Mercado Pago o a las tarjetas, y los cheques en
//     cartera. Una caja cerrada no tiene «esperado»: se contó y se retiró.
//   - **Ganancia del mes**: ventas netas (sin IVA) − costo de lo vendido −
//     gastos, contra el mismo lapso del mes anterior.

// MeDeben es la cuenta corriente de los clientes más los pedidos entregados
// sin cobrar. Total los suma; Vencido es solo el de la cuenta corriente (el
// aging), porque los pedidos van en su propio renglón.
type MeDeben struct {
	Total              float64 `json:"total"`
	Vencido            float64 `json:"vencido"`
	Clientes           int     `json:"clientes"`
	ClientesConVencido int     `json:"clientesConVencido"`
	PedidosSinCobrar   Monto   `json:"pedidosSinCobrar"`
}

// Debo es lo que se les debe a los proveedores, según sus libros.
type Debo struct {
	Total              float64 `json:"total"`
	Facturas           int     `json:"facturas"`
	Vencido            float64 `json:"vencido"`
	FacturasVencidas   int     `json:"facturasVencidas"`
	EstaSemana         float64 `json:"estaSemana"`
	FacturasEstaSemana int     `json:"facturasEstaSemana"`
	// Lo que el libro debe por encima de las facturas con saldo: el saldo
	// inicial, los ajustes, lo recibido con remito y sin factura.
	SinFactura float64 `json:"sinFactura"`
	// A cuántos proveedores se les debe.
	Proveedores int `json:"proveedores"`
}

// Monto es un total con cuántos lo forman.
type Monto struct {
	Total    float64 `json:"total"`
	Cantidad int     `json:"cantidad"`
}

// ChequesDeLaSemana son los que mueven plata en los próximos siete días.
type ChequesDeLaSemana struct {
	ACobrar Monto `json:"aCobrar"`
	ACubrir Monto `json:"aCubrir"`
}

// CajaAbierta es el efectivo que tendría que haber ahora en una sucursal.
type CajaAbierta struct {
	BranchID string  `json:"branchId"`
	Sucursal string  `json:"sucursal"`
	Esperado float64 `json:"esperado"`
}

// PlataHoy es la plata del día.
type PlataHoy struct {
	Cajas       []CajaAbierta `json:"cajas"`
	Efectivo    float64       `json:"efectivo"`
	Banco       float64       `json:"banco"`
	MercadoPago float64       `json:"mercadoPago"`
	Tarjetas    float64       `json:"tarjetas"`
	Cheques     Monto         `json:"cheques"`
	Total       float64       `json:"total"`
}

// Resultado es ventas netas − lo vendido sin costo − costo − gastos de un
// lapso.
type Resultado struct {
	VentasNetas float64 `json:"ventasNetas"`
	// VentasSinCosto es la parte de VentasNetas de los renglones sin costo
	// cargado (o en $0): queda afuera del resultado, como queda afuera del
	// margen de Reportes.
	VentasSinCosto float64 `json:"ventasSinCosto"`
	Costo          float64 `json:"costo"`
	Gastos         float64 `json:"gastos"`
	Resultado      float64 `json:"resultado"`
	// LineasSinCosto: cuántos renglones forman VentasSinCosto.
	LineasSinCosto int `json:"lineasSinCosto"`
	// ConDescuento: la regla del negocio resta el descuento del pedido de
	// las ventas, y VentasNetas ya no es el «Vendido sin IVA» de Reportes.
	ConDescuento bool `json:"conDescuento"`
	// SinCostosCargados: más de la mitad de lo vendido no tiene costo, y el
	// resultado no dice cuánto se ganó sino cuánto falta cargar. La pantalla
	// muestra «Sin costos cargados» y deja la cifra de dato al lado: un
	// «$0» en grande se leía como un mes sin ganancia.
	SinCostosCargados bool `json:"sinCostosCargados"`
}

// UmbralSinCostos es la parte de lo vendido sin costo a partir de la cual la
// ganancia deja de mostrarse como cifra (decisión 8 del comité final: la
// propuesta es 50 %, a confirmar con Nahuel).
const UmbralSinCostos = 0.5

// ResultadoComparado es el del lapso y el del anterior.
type ResultadoComparado struct {
	Actual    Resultado `json:"actual"`
	Anterior  Resultado `json:"anterior"`
	Variacion *float64  `json:"variacion"`
}

// Anuladas son las ventas del mostrador anuladas en los últimos siete días
// argentinos (hoy incluido): con «hoy» solo, el lunes no se veían las del
// sábado.
//
// Devuelto es el efectivo que salió de la caja por esas anulaciones (los
// cash_movements «devolucion», con la fecha del movimiento): el mismo número
// que ve el arqueo. La parte con tarjeta, Mercado Pago, transferencia,
// cheque o cuenta corriente no salió del cajón, y la anulación de una venta
// cobrada así no es plata que se fue.
//
// ConFacturaViva son las ventas anuladas, de cualquier fecha y origen, que
// siguen con su factura autorizada y sin nota de crédito que la acredite:
// para el fisco esa venta existe y su IVA se debe. Es el mismo número que el
// pendiente del Cierre; contar solo las de la semana hacía que la misma
// cosa diera dos cantidades, y una de hace diez días dejaba de verse.
type Anuladas struct {
	Cantidad       int     `json:"cantidad"`
	Total          float64 `json:"total"`
	Devuelto       float64 `json:"devuelto"`
	ConFacturaViva int     `json:"conFacturaViva"`
}

// NumerosDelDueno es todo junto.
type NumerosDelDueno struct {
	MeDeben  MeDeben            `json:"meDeben"`
	Debo     Debo               `json:"debo"`
	Cheques  ChequesDeLaSemana  `json:"cheques"`
	PlataHoy PlataHoy           `json:"plataHoy"`
	Ganancia ResultadoComparado `json:"ganancia"`
	// Devoluciones del mes (argentino): la plata que salió por devoluciones
	// parciales. El control de las devoluciones es que el dueño las vea.
	Devoluciones Totales `json:"devoluciones"`
	Anuladas Anuladas           `json:"anuladas"`
	// Controles sobre la plata del personal (T3).
	Controles Controles `json:"controles"`
}

// NumerosDelDueno arma los cinco bloques.
func (s *Servicio) NumerosDelDueno(ctx context.Context) (NumerosDelDueno, error) {
	ahora := s.ahora()
	var n NumerosDelDueno
	var err error
	if n.MeDeben, err = s.MeDeben(ctx, ahora); err != nil {
		return n, err
	}
	if n.Debo, err = s.Debo(ctx, ahora); err != nil {
		return n, err
	}
	if n.Cheques, err = s.ChequesDeLaSemana(ctx, ahora); err != nil {
		return n, err
	}
	if n.PlataHoy, err = s.PlataHoy(ctx, ahora); err != nil {
		return n, err
	}
	if n.Ganancia, err = s.GananciaDelMes(ctx, ahora); err != nil {
		return n, err
	}
	if n.Anuladas, err = s.AnuladasDeLaSemana(ctx, ahora); err != nil {
		return n, err
	}
	if n.Controles, err = s.ControlesDelPersonal(ctx, ahora); err != nil {
		return n, err
	}
	a := ahora.In(Argentina)
	inicio := time.Date(a.Year(), a.Month(), 1, 0, 0, 0, 0, Argentina)
	err = s.lectura.QueryRow(ctx, `SELECT coalesce(sum(importe), 0)::float8, count(*)::int FROM devoluciones WHERE created_at >= $1`, inicio).
		Scan(&n.Devoluciones.Total, &n.Devoluciones.Cantidad)
	return n, err
}

// deudaDeClientes es, de cada cliente que debe, su saldo y lo vencido (los
// tramos del aging que pasan sus días de crédito), como el listado de
// clientes.
func (s *Servicio) deudaDeClientes(ctx context.Context, hoy time.Time) (map[string][2]float64, error) {
	rs, err := s.pool.Query(ctx, `
		SELECT m.customer_id::text, c.dias_credito, m.monto, m.created_at
		FROM account_movements m JOIN customers c ON c.id = m.customer_id
		WHERE m.customer_id IN (SELECT customer_id FROM account_movements GROUP BY customer_id HAVING sum(monto) > 0)`)
	if err != nil {
		return nil, err
	}
	movs := map[string][]cobros.Movimiento{}
	dias := map[string]int{}
	var id string
	var d int32
	var monto jsmath.Num
	var fecha time.Time
	if _, err := pgx.ForEachRow(rs, []any{&id, &d, &monto, &fecha}, func() error {
		movs[id] = append(movs[id], cobros.Movimiento{Monto: monto.F(), Fecha: fecha})
		dias[id] = int(d)
		return nil
	}); err != nil {
		return nil, err
	}
	out := map[string][2]float64{}
	for id, m := range movs {
		a := cobros.CalcularAging(m, hoy)
		if !(a.Total > 0) {
			continue
		}
		vencido := 0.0
		for _, t := range a.Tramos {
			if t.Desde > dias[id] {
				vencido += t.Monto
			}
		}
		out[id] = [2]float64{a.Total, vencido}
	}
	return out, nil
}

// sinCobrarDeLoQueSalio es, sobre la fila `o`, lo que se debe de la
// mercadería que ya salió: del pedido entregado, todo lo que falta cobrar;
// del que salió en parte con remitos, lo remitido (a su precio, en la
// proporción del total del pedido) menos lo cobrado, sin pasar lo que falta.
// Con solo los entregados, la obra que se lleva la mitad con un remito y no
// pagó nada no aparecía en «Me deben» hasta el último remito (comité final,
// M4).
const sinCobrarDeLoQueSalio = `(CASE WHEN o.estado = 'entregado' THEN ` + fragmentos.SinCobrarDelPedido + `
	WHEN ` + fragmentos.SinCobrarDelPedido + ` IS NULL THEN NULL
	ELSE least(` + fragmentos.SinCobrarDelPedido + `, greatest(o.total * coalesce((
	  SELECT sum(di.cantidad * oi.subtotal / nullif(oi.cantidad, 0)) FROM delivery_items di
	  JOIN deliveries d ON d.id = di.delivery_id AND d.estado <> 'anulada' JOIN order_items oi ON oi.id = di.order_item_id
	  WHERE d.order_id = o.id) / nullif((SELECT sum(oi.subtotal) FROM order_items oi WHERE oi.order_id = o.id), 0), 0)
	  - ` + fragmentos.CobradoDelPedido + `, 0)) END)`

// MeDeben suma la deuda de los clientes.
func (s *Servicio) MeDeben(ctx context.Context, ahora time.Time) (MeDeben, error) {
	var m MeDeben
	deudas, err := s.deudaDeClientes(ctx, ahora)
	if err != nil {
		return m, err
	}
	for _, d := range deudas {
		m.Total += d[0]
		m.Clientes++
		if d[1] > 0.005 {
			m.Vencido += d[1]
			m.ClientesConVencido++
		}
	}
	var sinCobrar jsmath.Num
	if err := s.pool.QueryRow(ctx, `
		SELECT coalesce(sum(saldo), 0), count(*)::int
		FROM (SELECT `+sinCobrarDeLoQueSalio+` AS saldo FROM orders o
		      WHERE o.estado = 'entregado'
		         OR (o.estado <> 'cancelado' AND EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id AND d.estado <> 'anulada'))) x
		WHERE saldo > 0.009`).Scan(&sinCobrar, &m.PedidosSinCobrar.Cantidad); err != nil {
		return m, err
	}
	m.PedidosSinCobrar.Total = sinCobrar.F()
	m.Total = jsmath.Redondear2(float64(m.Total + m.PedidosSinCobrar.Total))
	m.Vencido = jsmath.Redondear2(m.Vencido)
	return m, nil
}

// anuladaEn es el momento de la anulación de la fila `o`: el último paso a
// «cancelado» del historial (mostrador.Anular lo deja ahí).
const anuladaEn = `(SELECT max(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.estado = 'cancelado')`

// AnuladasDeLaSemana cuenta las ventas del mostrador anuladas desde el
// inicio del día de hace seis días. Devuelto es lo que sacó de la caja la
// anulación: el efectivo de una devolución parcial anterior ya está en
// «Devoluciones del mes», y sumarlo acá lo mostraba dos veces.
func (s *Servicio) AnuladasDeLaSemana(ctx context.Context, ahora time.Time) (Anuladas, error) {
	var a Anuladas
	var total, devuelto jsmath.Num
	desde := InicioDelDia(ahora).AddDate(0, 0, -6)
	hasta := InicioDelDia(ahora).AddDate(0, 0, 1)
	err := s.pool.QueryRow(ctx, `
		SELECT count(*)::int, coalesce(sum(o.total), 0),
		  (SELECT count(*)::int FROM orders o WHERE o.estado = 'cancelado' AND `+fragmentos.FacturaViva+`),
		  (SELECT coalesce(-sum(m.monto), 0) FROM cash_movements m
		   JOIN orders d ON d.id = m.order_id AND d.origen = 'mostrador' AND d.estado = 'cancelado'
		   WHERE m.tipo = 'devolucion' AND m.created_at >= $1 AND m.created_at < $2
		     AND NOT EXISTS (SELECT 1 FROM devoluciones dv WHERE dv.cash_movement_id = m.id))
		FROM orders o
		WHERE o.origen = 'mostrador' AND o.estado = 'cancelado' AND `+anuladaEn+` >= $1 AND `+anuladaEn+` < $2`, desde, hasta).
		Scan(&a.Cantidad, &total, &a.ConFacturaViva, &devuelto)
	a.Total, a.Devuelto = total.F(), devuelto.F()
	return a, err
}

// saldoDeCompra es el saldo de cada factura de compra (las notas de crédito
// no son deuda: restan aparte en la cuenta del proveedor).
const saldoDeCompra = `(f.total - coalesce((SELECT sum(a.importe) FROM supplier_payment_allocations a WHERE a.purchase_invoice_id = f.id), 0))`

// Debo suma, proveedor por proveedor, lo que dice su libro.
//
// Cada proveedor por separado: un saldo a favor con uno (un anticipo, una
// nota de crédito) no descuenta lo que se le debe a otro, y se muestra aparte
// en Pagos. Lo vencido y lo de esta semana salen de sus facturas pero nunca
// pasan su libro: un pago a cuenta sin imputar baja el libro y no las
// facturas, y sin el tope lo vencido quedaba por encima de lo que se debe.
// Entran los proveedores inactivos con deuda: dejar de comprarle a alguien no
// salda la cuenta (Pagos los lista también, por lo mismo).
func (s *Servicio) Debo(ctx context.Context, ahora time.Time) (Debo, error) {
	var d Debo
	hoy := InicioDelDia(ahora)
	rs, err := s.pool.Query(ctx, `
		SELECT coalesce(l.saldo, 0)::float8,
		  coalesce(sum(x.saldo), 0)::float8, count(x.saldo)::int,
		  coalesce(sum(x.saldo) FILTER (WHERE x.vence < $1), 0)::float8, (count(*) FILTER (WHERE x.vence < $1))::int,
		  coalesce(sum(x.saldo) FILTER (WHERE x.vence >= $1 AND x.vence < $2), 0)::float8,
		  (count(*) FILTER (WHERE x.vence >= $1 AND x.vence < $2))::int
		FROM suppliers s
		LEFT JOIN (SELECT supplier_id, sum(monto) AS saldo FROM supplier_movements GROUP BY supplier_id) l ON l.supplier_id = s.id
		LEFT JOIN (SELECT f.supplier_id, `+saldoDeCompra+` AS saldo, f.fecha_vencimiento AS vence FROM purchase_invoices f
		      WHERE f.tipo::text NOT LIKE 'nota_credito%' AND f.anulada_at IS NULL) x ON x.supplier_id = s.id AND x.saldo > 0.009
		WHERE s.active
		GROUP BY s.id, l.saldo`, hoy, hoy.AddDate(0, 0, 7))
	if err != nil {
		return d, err
	}
	var libro, facturado, vencido, semana float64
	var facturas, vencidas, deLaSemana int
	if _, err := pgx.ForEachRow(rs, []any{&libro, &facturado, &facturas, &vencido, &vencidas, &semana, &deLaSemana}, func() error {
		r := DeudaConProveedor(libro, facturado, vencido, semana)
		if !(r.Debe > 0) {
			return nil
		}
		d.Total += r.Debe
		d.Proveedores++
		d.Facturas += facturas
		d.SinFactura += r.SinFactura
		if r.Vencido > 0 {
			d.Vencido += r.Vencido
			d.FacturasVencidas += vencidas
		}
		if r.EstaSemana > 0 {
			d.EstaSemana += r.EstaSemana
			d.FacturasEstaSemana += deLaSemana
		}
		return nil
	}); err != nil {
		return d, err
	}
	d.Total, d.Vencido = jsmath.Redondear2(d.Total), jsmath.Redondear2(d.Vencido)
	d.EstaSemana, d.SinFactura = jsmath.Redondear2(d.EstaSemana), jsmath.Redondear2(d.SinFactura)
	return d, nil
}

// DeudaDeUnProveedor es el reparto de lo que se le debe a uno.
type DeudaDeUnProveedor struct {
	Debe, Vencido, EstaSemana, SinFactura float64
}

// DeudaConProveedor reparte el libro de un proveedor: lo que se debe es el
// libro si es positivo; lo vencido, lo vencido de las facturas sin pasar el
// libro; lo de esta semana, sin pasar lo que queda; y lo que el libro tiene
// por encima de las facturas con saldo, sin factura.
func DeudaConProveedor(libro, facturado, vencido, semana float64) DeudaDeUnProveedor {
	if !(libro > 0.005) {
		return DeudaDeUnProveedor{}
	}
	r := DeudaDeUnProveedor{Debe: libro}
	r.Vencido = min(vencido, libro)
	r.EstaSemana = max(min(semana, jsmath.Redondear2(libro-r.Vencido)), 0)
	r.SinFactura = max(jsmath.Redondear2(libro-facturado), 0)
	return r
}

// InicioDelDia es el día argentino de `ahora`, a las 0.
func InicioDelDia(ahora time.Time) time.Time {
	a := ahora.In(Argentina)
	return time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, Argentina)
}

// ChequesDeLaSemana: hasta el fin del séptimo día, con los ya vencidos (un
// recibido pasado de fecha se deposita igual, y uno propio pasado de fecha
// puede debitar en cualquier momento).
func (s *Servicio) ChequesDeLaSemana(ctx context.Context, ahora time.Time) (ChequesDeLaSemana, error) {
	var c ChequesDeLaSemana
	var cobrar, cubrir jsmath.Num
	hasta := InicioDelDia(ahora).AddDate(0, 0, 8)
	err := s.pool.QueryRow(ctx, `
		SELECT coalesce(sum(importe) FILTER (WHERE sentido = 'recibido' AND estado IN ('cartera', 'depositado')), 0),
		  (count(*) FILTER (WHERE sentido = 'recibido' AND estado IN ('cartera', 'depositado')))::int,
		  coalesce(sum(importe) FILTER (WHERE sentido = 'entregado' AND estado = 'entregado'), 0),
		  (count(*) FILTER (WHERE sentido = 'entregado' AND estado = 'entregado'))::int
		FROM cheques WHERE fecha_pago < $1`, hasta).Scan(&cobrar, &c.ACobrar.Cantidad, &cubrir, &c.ACubrir.Cantidad)
	c.ACobrar.Total, c.ACubrir.Total = cobrar.F(), cubrir.F()
	return c, err
}

// PlataHoy: las cajas abiertas, lo cobrado hoy por otro medio que el
// efectivo y los cheques en cartera.
//
// Lo cobrado sale de tres lados que no se pisan: las partes de los recibos
// emitidos hoy (cuenta corriente, mostrador, portal), los pagos de las
// ventas del mostrador cobradas hoy (no emiten recibo) y los cobros en línea
// acreditados hoy que ningún recibo nombra (el pedido pagado en el sitio).
// La venta del mostrador se cobra al crearse: cobrada_at solo lo lleva la
// que llegó de la cola sin conexión (la hora en que se cobró de verdad), así
// que la de todos los días se mide por created_at, como la caja y Cobros.
// Con cobrada_at solo, lo cobrado con tarjeta o transferencia en el mostrador
// no aparecía nunca en «Plata hoy».
// El efectivo de los recibos y de las ventas ya está en el «esperado» de su
// caja, así que no se suma otra vez.
func (s *Servicio) PlataHoy(ctx context.Context, ahora time.Time) (PlataHoy, error) {
	p := PlataHoy{Cajas: []CajaAbierta{}}
	rs, err := s.pool.Query(ctx, `
		SELECT b.id, b.name, coalesce(sum(m.monto), 0)
		FROM cash_sessions s JOIN branches b ON b.id = s.branch_id
		LEFT JOIN cash_movements m ON m.session_id = s.id
		WHERE s.estado = 'abierta'
		GROUP BY b.id, b.name, b.sort_order ORDER BY b.sort_order`)
	if err != nil {
		return p, err
	}
	var c CajaAbierta
	var esperado jsmath.Num
	if _, err := pgx.ForEachRow(rs, []any{&c.BranchID, &c.Sucursal, &esperado}, func() error {
		c.Esperado = esperado.F()
		p.Cajas = append(p.Cajas, c)
		p.Efectivo += c.Esperado
		return nil
	}); err != nil {
		return p, err
	}
	hoy := InicioDelDia(ahora)
	var banco, mp, tarjetas, cheques jsmath.Num
	err = s.pool.QueryRow(ctx, `
		WITH cobrado AS (
		  SELECT CASE WHEN rp.medio IN ('transferencia', 'deposito') THEN 'banco'
		              WHEN rp.medio = 'mercado_pago' THEN 'mp'
		              WHEN rp.medio IN ('tarjeta_debito', 'tarjeta_credito') THEN 'tarjeta' END AS donde, rp.importe
		  FROM receipt_parts rp JOIN receipts r ON r.id = rp.receipt_id
		  WHERE r.estado = 'emitido' AND r.created_at >= $1 AND r.created_at < $2
		  UNION ALL
		  SELECT CASE WHEN op.medio = 'transferencia' THEN 'banco'
		              WHEN op.medio = 'mercado_pago' THEN 'mp'
		              WHEN op.medio IN ('debito', 'credito') THEN 'tarjeta' END, op.importe
		  FROM order_payments op JOIN orders o ON o.id = op.order_id
		  WHERE o.estado <> 'cancelado' AND coalesce(o.cobrada_at, o.created_at) >= $1 AND coalesce(o.cobrada_at, o.created_at) < $2
		  UNION ALL
		  SELECT CASE WHEN p.proveedor = 'transferencia' THEN 'banco' WHEN p.proveedor = 'mercado_pago' THEN 'mp' END, p.monto
		  FROM payments p
		  WHERE p.estado = 'aprobado' AND p.acreditado_at >= $1 AND p.acreditado_at < $2
		    AND NOT EXISTS (SELECT 1 FROM receipt_parts rp WHERE rp.payment_id = p.id)
		)
		SELECT coalesce(sum(importe) FILTER (WHERE donde = 'banco'), 0),
		  coalesce(sum(importe) FILTER (WHERE donde = 'mp'), 0),
		  coalesce(sum(importe) FILTER (WHERE donde = 'tarjeta'), 0),
		  (SELECT coalesce(sum(importe), 0) FROM cheques WHERE sentido = 'recibido' AND estado = 'cartera'),
		  (SELECT count(*)::int FROM cheques WHERE sentido = 'recibido' AND estado = 'cartera')
		FROM cobrado`, hoy, hoy.AddDate(0, 0, 1)).Scan(&banco, &mp, &tarjetas, &cheques, &p.Cheques.Cantidad)
	if err != nil {
		return p, err
	}
	p.Banco, p.MercadoPago, p.Tarjetas, p.Cheques.Total = banco.F(), mp.F(), tarjetas.F(), cheques.F()
	p.Efectivo = jsmath.Redondear2(p.Efectivo)
	// Las tarjetas se liquidan días después: no son plata de hoy. Se muestran
	// aparte, como lo que está por acreditarse, y no suman al total.
	p.Total = jsmath.Redondear2(float64(float64(p.Efectivo+p.Banco)+p.MercadoPago) + p.Cheques.Total)
	return p, nil
}

// ResultadoEntre es ventas netas − costo − gastos, sobre lo que tiene costo.
// Las ventas son instantes
// (el lapso argentino [idesde, ihasta)); los gastos se guardan como día, a
// las 0 UTC del día del formulario, y se cortan en [ddesde, dhasta) (ver
// cierre.go).
//
// Las ventas netas y el costo son los del reporte de ventas (margenes): cada
// renglón sin su IVA y su costo al momento de vender. Así el número del
// inicio, el del cierre y el de Reportes son el mismo.
//
// **Lo vendido sin costo queda afuera, y se dice cuánto es.** Restarle el
// costo de una parte a la venta del todo contaba cada renglón sin costo como
// ganancia entera: con $4M de $10M sin costo cargado, la Ganancia del mes
// mostraba esos $4M como plata ganada mientras Reportes, con la misma
// venta, medía el margen sobre lo costeado. Ahora es una sola regla: el
// resultado sale de lo que tiene costo y VentasSinCosto va al lado, en
// plata. Los gastos van enteros.
//
// Dos reglas las decide el dueño en Reglas del negocio: si los gastos entran
// con su IVA o sin él (el neto de la factura de compra a la que están atados;
// un gasto suelto no tiene el IVA aparte y entra entero), y si a las ventas
// se les resta el descuento del pedido (prorrateado en sus renglones).
func (s *Servicio) ResultadoEntre(ctx context.Context, idesde, ihasta, ddesde, dhasta time.Time) (Resultado, error) {
	var r Resultado
	var neto, sinCosto, costo, gastos jsmath.Num
	sinIva := s.ajuste(ctx, "ganancia_gastos", "con_iva") == "sin_iva"
	r.ConDescuento = s.ajuste(ctx, "ganancia_descuento", "no") == "si"
	gasto := "e.importe"
	if sinIva {
		gasto = "CASE WHEN f.total > 0 THEN e.importe * (f.neto + f.exento) / f.total ELSE e.importe END"
	}
	const delPeriodo = `o.estado <> 'cancelado' AND o.fecha >= $1 AND o.fecha < $2`
	err := s.pool.QueryRow(ctx, `
		SELECT `+ventasNetas(r.ConDescuento, "margenes.neto")+`,
		  `+ventasNetas(r.ConDescuento, "(margenes.neto - coalesce(margenes.neto_costeado, 0))")+`,
		  coalesce(sum(margenes.costo), 0), coalesce(sum(margenes.sin_costo), 0)::int,
		  (SELECT coalesce(sum(`+gasto+`), 0) FROM expenses e LEFT JOIN purchase_invoices f ON f.id = e.purchase_invoice_id
		   WHERE e.fecha >= $3 AND e.fecha < $4)
		FROM `+hechosDeVenta+` o `+margenesDe(delPeriodo)+`
		WHERE `+delPeriodo, idesde, ihasta, ddesde, dhasta).
		Scan(&neto, &sinCosto, &costo, &r.LineasSinCosto, &gastos)
	if err != nil {
		return r, err
	}
	r.VentasNetas, r.VentasSinCosto = jsmath.Redondear2(neto.F()), jsmath.Redondear2(sinCosto.F())
	r.Costo, r.Gastos = jsmath.Redondear2(costo.F()), jsmath.Redondear2(gastos.F())
	r.Resultado = jsmath.Redondear2(float64(float64(r.VentasNetas-r.VentasSinCosto)-r.Costo) - r.Gastos)
	r.SinCostosCargados = r.VentasNetas > 0 && r.VentasSinCosto > float64(r.VentasNetas*UmbralSinCostos)
	return r, nil
}

// ventasNetas suma `neto` (una expresión sobre margenes) de los pedidos `o`,
// con el descuento del pedido prorrateado si la regla lo pide. La usan el
// resultado y el reparto de lo vendido del Cierre, para que den lo mismo.
// Con `filtro`, solo las filas que lo cumplen.
func ventasNetas(conDescuento bool, neto string, filtro ...string) string {
	donde := ""
	if len(filtro) > 0 {
		donde = " FILTER (WHERE " + strings.Join(filtro, " AND ") + ")"
	}
	if conDescuento {
		neto += " * CASE WHEN o.subtotal > 0 THEN (o.total - o.costo_envio) / o.subtotal ELSE 1 END"
	}
	return "coalesce(sum(" + neto + ")" + donde + ", 0)"
}

// diaUTC es el día argentino de t como lo guardan los gastos (las 0 UTC).
func diaUTC(t time.Time) time.Time {
	a := t.In(Argentina)
	return time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, time.UTC)
}

// GananciaDelMes es el resultado del mes en curso hasta ahora contra el del
// mes anterior hasta el mismo día y hora: comparar medio mes contra un mes
// entero siempre da para abajo.
func (s *Servicio) GananciaDelMes(ctx context.Context, ahora time.Time) (ResultadoComparado, error) {
	var r ResultadoComparado
	desde := InicioDeMes(ahora, 0)
	antes := InicioDeMes(ahora, 1)
	// El mismo momento del mes pasado, sin pasarse de su último día (el 31
	// de marzo contra el 28 de febrero, no contra el 3 de marzo).
	a := ahora.In(Argentina)
	ultimo := desde.AddDate(0, 0, -1).Day()
	hastaAntes := time.Date(antes.Year(), antes.Month(), min(a.Day(), ultimo), a.Hour(), a.Minute(), a.Second(), a.Nanosecond(), Argentina)
	var err error
	// Los gastos van por día entero: el de hoy cuenta.
	if r.Actual, err = s.ResultadoEntre(ctx, desde, ahora, diaUTC(desde), diaUTC(ahora).AddDate(0, 0, 1)); err != nil {
		return r, err
	}
	if r.Anterior, err = s.ResultadoEntre(ctx, antes, hastaAntes, diaUTC(antes), diaUTC(hastaAntes).AddDate(0, 0, 1)); err != nil {
		return r, err
	}
	r.Variacion = VariacionConSigno(r.Actual.Resultado, r.Anterior.Resultado)
	return r, nil
}

// ResultadoDelMes es el del mes del cierre (días en UTC, como PeriodoDelCierre)
// contra el mes anterior entero.
func (s *Servicio) ResultadoDelMes(ctx context.Context, p PeriodoMensual) (ResultadoComparado, error) {
	var r ResultadoComparado
	desde := time.Date(p.Anio, time.Month(p.Mes), 1, 0, 0, 0, 0, time.UTC)
	hasta := desde.AddDate(0, 1, 0)
	antes := desde.AddDate(0, -1, 0)
	enArgentina := func(t time.Time) time.Time { return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, Argentina) }
	var err error
	if r.Actual, err = s.ResultadoEntre(ctx, enArgentina(desde), enArgentina(hasta), desde, hasta); err != nil {
		return r, err
	}
	if r.Anterior, err = s.ResultadoEntre(ctx, enArgentina(antes), enArgentina(desde), antes, desde); err != nil {
		return r, err
	}
	r.Variacion = VariacionConSigno(r.Actual.Resultado, r.Anterior.Resultado)
	return r, nil
}

// VariacionConSigno es Variacion para un número que puede ser negativo (un
// resultado): contra una pérdida, ganar menos que antes no es «−50 %». Se
// divide por el valor absoluto del anterior, así pasar de −100 a +100 es
// +200 %. Sin anterior (cero) no hay comparación.
func VariacionConSigno(actual, previo float64) *float64 {
	if previo == 0 {
		return nil
	}
	base := previo
	if base < 0 {
		base = -base
	}
	v := jsmath.Round(float64((actual-previo)/base)*1000) / 10
	return &v
}

// ajuste lee una regla del negocio de site_settings, o la de siempre si no
// está cargada.
func (s *Servicio) ajuste(ctx context.Context, clave, porDefecto string) string {
	var v string
	if err := s.pool.QueryRow(ctx, `SELECT valor FROM site_settings WHERE clave = $1`, clave).Scan(&v); err != nil || v == "" {
		return porDefecto
	}
	return v
}
