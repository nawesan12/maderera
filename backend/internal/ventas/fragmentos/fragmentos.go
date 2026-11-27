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
//   - El pedido partido (a_cuenta, H047) dejó una parte en la cuenta: lo
//     que falta es el resto, fuera de la cuenta, y esa parte no se resta.
const SinCobrarDelPedido = `(CASE WHEN o.estado <> 'cancelado' AND o.estado_pago IN ('pendiente', 'rechazado')
	  AND ` + DeudaFueraDeLaCuenta + `
	  AND NOT ` + PagoEnRevision + `
	THEN nullif(greatest(` + ACobrarFueraDeLaCuenta + ` - ` + CobradoDelPedido + `, 0), 0) END)`

// DeudaFueraDeLaCuenta: lo que falta cobrar del pedido `o` no está en la
// cuenta corriente del cliente. Un pedido de contado; no uno a cuenta (el
// medio cuenta_corriente, o la «compra» asentada con su número). El
// partido (a_cuenta) sí: su resto se cobra como uno de contado.
const DeudaFueraDeLaCuenta = `(o.a_cuenta IS NOT NULL OR (o.medio_pago IS DISTINCT FROM 'cuenta_corriente'
	  AND NOT EXISTS (SELECT 1 FROM account_movements am
	                  WHERE am.customer_id = o.customer_id AND am.referencia = o.numero AND am.tipo = 'compra')))`

// ACobrarFueraDeLaCuenta es ACobrarDelPedido menos lo que el pedido partido
// cargó a la cuenta: el resto, que se cobra con un recibo del pedido.
const ACobrarFueraDeLaCuenta = `(` + ACobrarDelPedido + ` - coalesce(o.a_cuenta, 0))`

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

// FacturaSinBaja: el pedido `o` tiene una factura sin CAE que sigue
// numerada (emitida o rechazada). En una venta anulada no se autoriza nunca
// (facturacion.ventaAnulada): hay que darla de baja, y el cliente ya pudo
// haberla recibido. Antes no entraba en ninguna lista y se la encontraba
// recorriendo Facturación hoja por hoja, con «Registrar cobro» a mano
// (simulación del mes, H236).
const FacturaSinBaja = `EXISTS (SELECT 1 FROM invoices fb WHERE fb.order_id = o.id AND ` + facturaSinBaja + `)`

// FacturaSinBajaDeLaFila es FacturaSinBaja sobre la fila `i` de invoices.
var FacturaSinBajaDeLaFila = strings.ReplaceAll(facturaSinBaja, "fb.", "i.")

const facturaSinBaja = `fb.cae IS NULL AND fb.estado IN ('emitida', 'rechazada') AND fb.tipo::text NOT LIKE 'nota_credito%'`

// FacturaSinAcreditar es la misma regla sobre la fila `i` de invoices: la
// usa el filtro de Facturación que lleva a cada una (estado=anulada-viva).
var FacturaSinAcreditar = strings.ReplaceAll(facturaSinAcreditar, "fv.", "i.")

const facturaSinAcreditar = `fv.estado <> 'borrador' AND fv.cae IS NOT NULL AND fv.tipo::text NOT LIKE 'nota_credito%'
	AND fv.total - coalesce((SELECT sum(nc.total) FROM invoices nc WHERE nc.comprobante_origen_id = fv.id
	      AND nc.tipo::text LIKE 'nota_credito%' AND nc.cae IS NOT NULL AND nc.estado NOT IN ('borrador', 'anulada', 'rechazada')), 0) > 0.009`

// CircuitoDelCheque es, sobre la fila `ch` de cheques (con otro alias si se
// pasa), el circuito en el que está el valor: «blanco» o «negro».
//
// **El cheque de una venta del mostrador no lo guarda, lo calcula.** Va con
// el cobro de su venta (la sección 4 de los asientos): es blanco si el pedido
// tiene una factura emitida, con CAE o esperándolo (el cobro va al archivo
// del estudio contra Anticipos hasta el CAE, y el que se cobró antes pasa
// ahí el día de la factura), o si la regla «cobro_antes_de_facturar» manda
// lo cobrado antes de facturar a Anticipos; si no, es del B. No se puede
// fijar al cobrar, porque la factura puede salir después de la venta. Así el
// cheque de la venta esperando el CAE se puede endosar a una factura A
// (M2S2-024, M2S2-040).
//
// **El de un recibo va adonde lo mandó el reparto** (circuito_reparto, que
// fija cobros.FijarReparto): el que el recibo mandó entero al B es del B
// aunque se haya cobrado «blanco» (mes simulado, M3S3-001 y M3S3-005: entraba
// a Valores a depositar del archivo B y su acreditación salía del A). El
// recibo de antes de esa columna se lee por su reparto. El partido queda con
// el suyo. Los entregados llevan el suyo.
func CircuitoDelCheque(ch string) string {
	return strings.ReplaceAll(`(CASE WHEN ch.order_payment_id IS NULL THEN coalesce(nullif(ch.circuito_reparto, 'partido'),
	    CASE WHEN ch.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts cre WHERE cre.id = ch.receipt_id
	           AND cre.reparto_b > 0.005 AND coalesce(cre.reparto_deudores, 0) + coalesce(cre.reparto_anticipo, 0) < 0.005)
	      THEN 'negro' ELSE ch.circuito::text END)
	  WHEN EXISTS (SELECT 1 FROM order_payments cop JOIN invoices cfi ON cfi.order_id = cop.order_id
	               WHERE cop.id = ch.order_payment_id AND cfi.tipo::text LIKE 'factura%' AND cfi.estado <> 'borrador'
	                 AND cfi.cae_ambiente IS DISTINCT FROM 'homologacion')
	    OR EXISTS (SELECT 1 FROM site_settings crg WHERE crg.clave = 'cobro_antes_de_facturar' AND crg.valor = 'anticipos')
	  THEN 'blanco' ELSE 'negro' END)`, "ch.", ch+".")
}

// chequeEsperaCAE es que el cheque es de una venta con su factura emitida y
// sin CAE todavía (ni anulada ni de prueba).
const chequeEsperaCAE = `EXISTS (SELECT 1 FROM order_payments eop JOIN invoices efi ON efi.order_id = eop.order_id
	  WHERE eop.id = ch.order_payment_id AND efi.tipo::text LIKE 'factura%' AND efi.estado NOT IN ('borrador', 'anulada')
	    AND efi.cae IS NULL)`

// ChequeEsperaCAE es chequeEsperaCAE sobre la fila `ch` (con otro alias si
// se pasa): la pantalla de cheques dice «Espera CAE» y no «Circuito B».
func ChequeEsperaCAE(ch string) string {
	return "(" + strings.ReplaceAll(chequeEsperaCAE, "ch.", ch+".") + ")"
}

// FechaDelCheque es, sobre la fila `ch` de cheques, la fecha con la que el
// cierre asienta un cambio de estado del cheque ocurrido en `at`.
//
// **El cheque del mostrador cobrado antes de la factura no puede mover un
// mes ya entregado.** CircuitoDelCheque lo vuelve blanco cuando la factura
// sale, y la sección 4 de los asientos corre su cobro (Valores a depositar a
// Deudores) a la fecha de la factura. Con la fecha del evento, un depósito
// acreditado en octubre de una venta facturada en noviembre aparecía en
// octubre al volver a sacarlo (octubre distinto de lo entregado y Valores a
// depositar acreedor hasta noviembre). Corrido a la misma factura que miran
// la sección 4 y CircuitoDelCheque, el cobro y el depósito caen juntos. Los
// demás cheques (sin order_payment_id) llevan la fecha del evento.
func FechaDelCheque(ch, at string) string {
	return strings.NewReplacer("ch.", ch+".", "{AT}", at).Replace(`(CASE WHEN ch.order_payment_id IS NULL THEN {AT}
	  ELSE greatest({AT}, coalesce((SELECT least(cfi.created_at, cfi.fecha_emision) FROM order_payments cop JOIN invoices cfi ON cfi.order_id = cop.order_id
	               WHERE cop.id = ch.order_payment_id AND cfi.tipo::text LIKE 'factura%' AND cfi.estado <> 'borrador'
	                 AND cfi.cae_ambiente IS DISTINCT FROM 'homologacion'
	               ORDER BY cfi.created_at, cfi.id LIMIT 1), {AT})) END)`)
}

// Los hechos de venta de los reportes (ver internal/reportes/ventas.go): la
// venta en la fecha que dice la regla «venta_reconocida» (orders.vendido_at),
// cada devolución en la suya en negativo y la cancelación posterior también.
// Columnas: las de orders más hecho, fecha, monto (con IVA) y operaciones.
const (
	HechosDeVenta = `(SELECT o.*, o.id AS hecho, o.vendido_at AS fecha, o.total AS monto, 1 AS operaciones
		  FROM orders o WHERE o.vendido_at IS NOT NULL AND ` + CuentaComoVenta + `
		UNION ALL
		SELECT o.*, dv.id, dv.created_at, -dv.importe, 0 FROM devoluciones dv JOIN orders o ON o.id = dv.order_id
		  WHERE ` + CuentaComoVenta + `
		UNION ALL
		SELECT o.*, ` + HechoDeLaCancelacion + `, o.cancelado_at,
		  -(o.total - coalesce((SELECT sum(dv.importe) FROM devoluciones dv WHERE dv.order_id = o.id), 0)), 0
		  FROM orders o WHERE ` + CanceladaDespues + `)`
	// cuentaComoVenta: el pedido no se canceló, o se canceló después de
	// contar como venta.
	CuentaComoVenta  = `(o.estado <> 'cancelado' OR (o.vendido_at IS NOT NULL AND o.cancelado_at > o.vendido_at))`
	CanceladaDespues = `o.estado = 'cancelado' AND o.vendido_at IS NOT NULL AND o.cancelado_at > o.vendido_at`
	// hechoDeLaCancelacion es el id del hecho que resta la cancelación.
	HechoDeLaCancelacion = `md5('cancelacion:' || o.id::text)::uuid`
)

// MotivoDelDescuento es, sobre la fila `o`, el motivo del descuento como se
// lee: si el descuento salió de la escala de un medio («10% por
// transferencia», el que se eligió al pasar el presupuesto a pedido) y el
// pedido se terminó cobrando entero con recibos de otro medio que tiene su
// escala («10% en efectivo»), el de ese medio. PED-1123, cobrado en
// efectivo, decía «10% por transferencia» (mes 23). Si no, el guardado.
const MotivoDelDescuento = `coalesce((SELECT pd2.etiqueta FROM payment_discounts pd2
	  WHERE pd2.activo AND pd2.etiqueta <> '' AND o.estado_pago = 'pagado'
	    AND o.descuento_motivo IN (SELECT pd3.etiqueta FROM payment_discounts pd3 WHERE pd3.medio::text <> pd2.medio::text)
	    AND pd2.medio::text = (SELECT min(rpm.medio::text) FROM receipt_parts rpm JOIN receipts rcm ON rcm.id = rpm.receipt_id
	                           WHERE rcm.estado = 'emitido' AND rcm.id IN ` + recibosDelPedido + `
	                           HAVING count(DISTINCT rpm.medio) = 1)
	  ORDER BY pd2.desde_monto DESC LIMIT 1), o.descuento_motivo)`

// RetiroSinFirmar es, sobre la fila `o` de orders, si el pedido tiene un
// remito de retiro preparado que el cliente todavía no firmó. La venta del
// mostrador queda «entregado» al cobrarse, con el remito para firmar: el
// portal la listaba «Entregado» y ofrecía reseñarla antes de la firma (mes
// 23, M2S1-071).
const RetiroSinFirmar = `EXISTS (SELECT 1 FROM deliveries rs WHERE rs.order_id = o.id AND rs.estado = 'preparada' AND rs.tipo = 'retiro')`

// EstadoParaElCliente es el estado que ve el cliente: «listo» hasta que
// firma el retiro.
const EstadoParaElCliente = `(CASE WHEN o.estado = 'entregado' AND ` + RetiroSinFirmar + ` THEN 'listo' ELSE o.estado::text END)`
