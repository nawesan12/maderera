// Package fragmentos son las reglas de venta que se escriben en SQL y que
// comparten varias pantallas. No importa nada del sistema: así lo puede
// usar la caja, que el paquete ventas no deja (sus pruebas la importan).
package fragmentos

import "strings"

// SinCobrarDelPedido es, en SQL y sobre la fila `o` de orders, lo que falta
// cobrar de un pedido que no pasa por la cuenta corriente; NULL si no le
// falta nada o si su deuda vive en otro lado.
//
// Es la regla de «Me deben», de la confirmación al entregar y de la nota que
// queda en el historial, y por eso vive en un solo lugar: el dueño vio «Me
// deben $0» con mercadería entregada sin cobrar (un pedido de presupuesto a
// pagar en efectivo o transferencia se entregaba y desaparecía de todos los
// números).
//
//   - Solo `pendiente` y `rechazado`: `pagado` y `reintegrado` ya cerraron, y
//     `parcial` es la venta del mostrador que cargó su resto en la cuenta
//     corriente (ya está en account_movements).
//   - Lo que va a cuenta corriente ya es deuda del cliente en
//     account_movements: sumarlo acá lo contaría dos veces. Por eso afuera el
//     medio `cuenta_corriente` y cualquier pedido que haya cargado su
//     «compra» en la cuenta (el checkout la asienta con el número del pedido
//     como referencia).
//   - Es el saldo y no el total: lo cobrado en línea y aprobado (payments)
//     y los recibos vivos atados al pedido (receipts.order_id, la seña que
//     se cobra desde la ficha del cliente con «Cobro del pedido N») se
//     descuentan, así una seña no se reclama dos veces. El recibo asienta su
//     pago en la cuenta del cliente, pero esa cuenta queda a favor y «Me
//     deben» solo suma los saldos positivos: sin restarlo acá, se pedía el
//     total entero.
//   - Una transferencia informada con comprobante (payments «en_revision»)
//     no es deuda: el cliente dice que pagó y falta que administración lo
//     verifique. El reparto le pedía la plata otra vez a quien ya había
//     pagado. Si se rechaza, el pedido vuelve a estar sin cobrar.
//   - Lo devuelto de lo que no se había cobrado (una devolución parcial con
//     destino «deuda») baja lo que se debe: la mercadería volvió y nadie
//     pagó por ella. Lo devuelto por caja u otro medio no se resta: salió
//     la mercadería y salió la plata, y lo que falta queda igual.
const SinCobrarDelPedido = `(CASE WHEN o.estado <> 'cancelado' AND o.estado_pago IN ('pendiente', 'rechazado')
	  AND o.medio_pago IS DISTINCT FROM 'cuenta_corriente'
	  AND NOT EXISTS (SELECT 1 FROM account_movements am
	                  WHERE am.customer_id = o.customer_id AND am.referencia = o.numero AND am.tipo = 'compra')
	  AND NOT ` + PagoEnRevision + `
	THEN nullif(greatest(` + ACobrarDelPedido + ` - ` + CobradoDelPedido + `, 0), 0) END)`

// NotaEntregadoSinCobrar encabeza la nota del historial de un pedido que se
// entregó con algo sin cobrar (lo deja «Avanzar» y el remito que completa
// el pedido).
const NotaEntregadoSinCobrar = "Entregado sin cobrar"

// ACobrarDelPedido es el total de la fila `o` menos lo que las devoluciones
// le bajaron de la deuda (destino «deuda»): lo que hay que cobrar.
const ACobrarDelPedido = `(o.total - coalesce((SELECT sum(dv.importe) FROM devoluciones dv WHERE dv.order_id = o.id AND dv.destino = 'deuda'), 0))`

// CobradoDelPedido es, sobre la fila `o`, lo cobrado fuera de la caja del
// mostrador: los cobros en línea aprobados y los recibos vivos del pedido
// (recibosDelPedido). Es lo que SinCobrarDelPedido descuenta y lo que decide
// si un recibo deja el pedido pagado (cobros.CobrarACliente).
const CobradoDelPedido = `(coalesce((SELECT sum(pg.monto) FROM payments pg WHERE pg.order_id = o.id AND pg.estado = 'aprobado'), 0)
	+ coalesce((SELECT sum(rc.total) FROM receipts rc WHERE rc.estado = 'emitido' AND rc.id IN ` + recibosDelPedido + `), 0))`

// recibosDelPedido son los ids de los recibos del pedido `o`: los que lo
// cobran (receipts.order_id, el cobro desde la ficha) y los que cobran una
// de sus facturas desde Facturación, que no llevan el pedido y quedan atados
// solo por invoice_payments (revisión del carril E: la factura cobrada así
// no figuraba como cobrada, y la devolución ofrecía bajar la deuda por el
// total de algo que ya se había pagado).
const recibosDelPedido = `(SELECT rp1.id FROM receipts rp1 WHERE rp1.order_id = o.id
	UNION SELECT ip1.receipt_id FROM invoice_payments ip1 JOIN invoices if1 ON if1.id = ip1.invoice_id
	      WHERE if1.order_id = o.id AND ip1.receipt_id IS NOT NULL)`

// RecibosDelPedido es recibosDelPedido para otro pedido que la fila `o`:
// un parámetro ($1::uuid) o una columna.
func RecibosDelPedido(pedido string) string {
	return strings.ReplaceAll(recibosDelPedido, "o.id", pedido)
}

// SinCobrarDeLoQueSalio es, sobre la fila `o`, lo que se debe de la
// mercadería que ya salió: del pedido entregado, todo lo que falta cobrar;
// del que salió en parte con remitos, lo remitido (a su precio, en la
// proporción del total del pedido) menos lo cobrado, sin pasar lo que falta.
// Con solo los entregados, la obra que se lleva la mitad con un remito y no
// pagó nada no aparecía en «Me deben» hasta el último remito (comité final,
// M4). Es la cifra de «Me deben» y la del filtro «Sin cobrar» de Pedidos, al
// que lleva la tarjeta: tienen que dar lo mismo.
const SinCobrarDeLoQueSalio = `(CASE WHEN o.estado = 'entregado' THEN ` + SinCobrarDelPedido + `
	WHEN ` + SinCobrarDelPedido + ` IS NULL THEN NULL
	ELSE least(` + SinCobrarDelPedido + `, greatest(o.total * coalesce((
	  SELECT sum(di.cantidad * oi.subtotal / nullif(oi.cantidad, 0)) FROM delivery_items di
	  JOIN deliveries d ON d.id = di.delivery_id AND d.estado <> 'anulada' JOIN order_items oi ON oi.id = di.order_item_id
	  WHERE d.order_id = o.id) / nullif((SELECT sum(oi.subtotal) FROM order_items oi WHERE oi.order_id = o.id), 0), 0)
	  - ` + CobradoDelPedido + `, 0)) END)`

// SalioMercaderia: el pedido `o` está entregado, o no está cancelado y tiene
// algún remito vivo. Son los pedidos en los que SinCobrarDeLoQueSalio mira.
const SalioMercaderia = `(o.estado = 'entregado'
	OR (o.estado <> 'cancelado' AND EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id AND d.estado <> 'anulada')))`

// PagoEnRevision: el pedido `o` tiene una transferencia informada que nadie
// verificó todavía.
const PagoEnRevision = `EXISTS (SELECT 1 FROM payments pr WHERE pr.order_id = o.id AND pr.estado = 'en_revision')`

// FacturaViva: el pedido `o` tiene una factura con CAE (no nota de
// crédito) a la que le queda algo sin acreditar por notas de crédito con
// CAE. En una venta anulada es el riesgo fiscal: mostrador.Anular no toca el
// comprobante, y con CAE y sin nota de crédito su IVA sigue como débito en
// el libro.
//
// **Se decide por los importes y no por el estado de la factura.**
// facturacion.AnularConNota pasa la original a «anulada» en la misma
// transacción en que inserta la nota, que todavía no tiene CAE: si ARCA la
// rechaza o la demora, la original sigue con su débito en el libro (conCae
// cuenta las anuladas) y mirar el estado la daba por resuelta. Al revés, dos
// notas parciales que suman el total dejan la original «autorizada» (una
// parcial no anula): estaba resuelta y salía viva para siempre. Una nota
// anulada (revertida por una de débito) no resta.
const FacturaViva = `EXISTS (SELECT 1 FROM invoices fv WHERE fv.order_id = o.id AND ` + facturaSinAcreditar + `)`

// FacturaSinAcreditar es la misma regla sobre la fila `i` de invoices: la
// usa el filtro de Facturación que lleva a cada una (estado=anulada-viva).
var FacturaSinAcreditar = strings.ReplaceAll(facturaSinAcreditar, "fv.", "i.")

const facturaSinAcreditar = `fv.estado <> 'borrador' AND fv.cae IS NOT NULL AND fv.tipo::text NOT LIKE 'nota_credito%'
	AND fv.total - coalesce((SELECT sum(nc.total) FROM invoices nc WHERE nc.comprobante_origen_id = fv.id
	      AND nc.tipo::text LIKE 'nota_credito%' AND nc.cae IS NOT NULL AND nc.estado NOT IN ('borrador', 'anulada', 'rechazada')), 0) > 0.009`

// CircuitoDelCheque es, sobre la fila `ch` de cheques (con otro alias si se
// pasa), el circuito en el que está el valor: «blanco» o «negro».
//
// **El cheque de una venta del mostrador no lo guarda, lo calcula.** Nace
// con el «blanco» que pone cobros.RegistrarChequeRecibido, y una venta B
// del mostrador no tiene asiento de cobro (la sección 4 de los asientos
// solo asienta pagos de pedidos con factura con CAE): ese cheque nunca
// debitó Valores a depositar del estudio. Con el dato guardado, su depósito
// acreditaba esa cuenta en el estudio, donde nunca entró, y se podía endosar
// en un pago blanco (la fuga que cierra la regla M8 de compras). Y no se
// puede fijar al cobrar, porque la factura puede salir después de la venta:
// el valor guardado quedaría viejo. Por eso es blanco solo si el pedido
// tiene la misma factura que mira la sección 4 (con CAE y no de prueba).
// Los demás cheques (los de un recibo, los entregados) llevan el suyo.
func CircuitoDelCheque(ch string) string {
	return strings.ReplaceAll(`(CASE WHEN ch.order_payment_id IS NULL THEN ch.circuito::text
	  WHEN EXISTS (SELECT 1 FROM order_payments cop JOIN invoices cfi ON cfi.order_id = cop.order_id
	               WHERE cop.id = ch.order_payment_id AND cfi.tipo::text LIKE 'factura%' AND cfi.estado <> 'borrador'
	                 AND cfi.cae IS NOT NULL AND cfi.cae_ambiente IS DISTINCT FROM 'homologacion')
	  THEN 'blanco' ELSE 'negro' END)`, "ch.", ch+".")
}
