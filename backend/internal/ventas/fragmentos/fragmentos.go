// Package fragmentos son las reglas de venta que se escriben en SQL y que
// comparten varias pantallas. No importa nada: así lo puede usar la caja,
// que el paquete ventas no deja (sus pruebas la importan).
package fragmentos

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
//     se descuenta, así una seña no se reclama dos veces.
const SinCobrarDelPedido = `(CASE WHEN o.estado <> 'cancelado' AND o.estado_pago IN ('pendiente', 'rechazado')
	  AND o.medio_pago IS DISTINCT FROM 'cuenta_corriente'
	  AND NOT EXISTS (SELECT 1 FROM account_movements am
	                  WHERE am.customer_id = o.customer_id AND am.referencia = o.numero AND am.tipo = 'compra')
	THEN nullif(greatest(o.total - coalesce((SELECT sum(pg.monto) FROM payments pg
	                                         WHERE pg.order_id = o.id AND pg.estado = 'aprobado'), 0), 0), 0) END)`

// FacturaViva: el pedido `o` tiene una factura autorizada que no es nota de
// crédito ni quedó anulada por una (facturacion.AnularConNota la pasa a
// «anulada» cuando la acredita entera). En una venta anulada es el riesgo
// fiscal: mostrador.Anular no toca el comprobante, y con CAE y sin nota de
// crédito su IVA sigue como débito en el libro.
const FacturaViva = `EXISTS (SELECT 1 FROM invoices fv WHERE fv.order_id = o.id AND fv.estado NOT IN ('borrador', 'anulada')
	AND fv.cae IS NOT NULL AND fv.tipo::text NOT LIKE 'nota_credito%')`
