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
//   - **Debo** son las facturas de compra con saldo (total menos lo imputado
//     en pagos), sin las notas de crédito: el mismo saldo que «Pagar» de
//     compras. Lo que entró con remito y todavía no tiene factura no está acá:
//     no tiene vencimiento.
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

// Debo son las facturas de compra con saldo.
type Debo struct {
	Total              float64 `json:"total"`
	Facturas           int     `json:"facturas"`
	Vencido            float64 `json:"vencido"`
	FacturasVencidas   int     `json:"facturasVencidas"`
	EstaSemana         float64 `json:"estaSemana"`
	FacturasEstaSemana int     `json:"facturasEstaSemana"`
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
}

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
	Anuladas Anuladas           `json:"anuladas"`
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
	n.Anuladas, err = s.AnuladasDeLaSemana(ctx, ahora)
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
		FROM (SELECT `+fragmentos.SinCobrarDelPedido+` AS saldo FROM orders o WHERE o.estado = 'entregado') x
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
// inicio del día de hace seis días.
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
		   WHERE m.tipo = 'devolucion' AND m.created_at >= $1 AND m.created_at < $2)
		FROM orders o
		WHERE o.origen = 'mostrador' AND o.estado = 'cancelado' AND `+anuladaEn+` >= $1 AND `+anuladaEn+` < $2`, desde, hasta).
		Scan(&a.Cantidad, &total, &a.ConFacturaViva, &devuelto)
	a.Total, a.Devuelto = total.F(), devuelto.F()
	return a, err
}

// saldoDeCompra es el saldo de cada factura de compra (las notas de crédito
// no son deuda: restan aparte en la cuenta del proveedor).
const saldoDeCompra = `(f.total - coalesce((SELECT sum(a.importe) FROM supplier_payment_allocations a WHERE a.purchase_invoice_id = f.id), 0))`

// Debo suma las facturas de compra con saldo, lo vencido y lo que vence en
// los próximos siete días.
func (s *Servicio) Debo(ctx context.Context, ahora time.Time) (Debo, error) {
	var d Debo
	var total, vencido, semana jsmath.Num
	hoy := InicioDelDia(ahora)
	err := s.pool.QueryRow(ctx, `
		SELECT coalesce(sum(saldo), 0), count(*)::int,
		  coalesce(sum(saldo) FILTER (WHERE vence < $1), 0), (count(*) FILTER (WHERE vence < $1))::int,
		  coalesce(sum(saldo) FILTER (WHERE vence >= $1 AND vence < $2), 0), (count(*) FILTER (WHERE vence >= $1 AND vence < $2))::int
		FROM (SELECT `+saldoDeCompra+` AS saldo, f.fecha_vencimiento AS vence FROM purchase_invoices f
		      WHERE f.tipo::text NOT LIKE 'nota_credito%' AND f.anulada_at IS NULL) x
		WHERE saldo > 0.009`, hoy, hoy.AddDate(0, 0, 7)).
		Scan(&total, &d.Facturas, &vencido, &d.FacturasVencidas, &semana, &d.FacturasEstaSemana)
	d.Total, d.Vencido, d.EstaSemana = total.F(), vencido.F(), semana.F()
	return d, err
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
		  WHERE o.estado <> 'cancelado' AND o.cobrada_at >= $1 AND o.cobrada_at < $2
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
	err := s.pool.QueryRow(ctx, `
		SELECT `+ventasNetas(r.ConDescuento, "margenes.neto")+`,
		  `+ventasNetas(r.ConDescuento, "(margenes.neto - coalesce(margenes.neto_costeado, 0))")+`,
		  coalesce(sum(margenes.costo), 0), coalesce(sum(margenes.sin_costo), 0)::int,
		  (SELECT coalesce(sum(`+gasto+`), 0) FROM expenses e LEFT JOIN purchase_invoices f ON f.id = e.purchase_invoice_id
		   WHERE e.fecha >= $3 AND e.fecha < $4)
		FROM orders o `+margenes+`
		WHERE o.estado <> 'cancelado' AND o.created_at >= $1 AND o.created_at < $2`, idesde, ihasta, ddesde, dhasta).
		Scan(&neto, &sinCosto, &costo, &r.LineasSinCosto, &gastos)
	if err != nil {
		return r, err
	}
	r.VentasNetas, r.VentasSinCosto = jsmath.Redondear2(neto.F()), jsmath.Redondear2(sinCosto.F())
	r.Costo, r.Gastos = jsmath.Redondear2(costo.F()), jsmath.Redondear2(gastos.F())
	r.Resultado = jsmath.Redondear2(float64(float64(r.VentasNetas-r.VentasSinCosto)-r.Costo) - r.Gastos)
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
