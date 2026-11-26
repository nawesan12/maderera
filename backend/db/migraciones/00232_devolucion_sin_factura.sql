-- +goose Up
-- La devolución de un pedido que no se facturó (mes simulado, 26/11/2026).
-- La devolución parcial nacía siempre de una factura (su nota de crédito):
-- un pedido sin factura no tenía camino, el stock volvía con un ajuste suelto
-- sin decir de qué pedido, y el pedido seguía cobrando lo devuelto. Sin
-- factura no hay nota: la devolución baja lo que falta cobrar (o la cuenta
-- corriente) y lo que vuelve al stock queda atado a ella.
ALTER TABLE devoluciones ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE devolucion_items ALTER COLUMN invoice_item_id DROP NOT NULL;

-- +goose Down
DELETE FROM devolucion_items WHERE invoice_item_id IS NULL;
DELETE FROM devoluciones WHERE invoice_id IS NULL;
ALTER TABLE devolucion_items ALTER COLUMN invoice_item_id SET NOT NULL;
ALTER TABLE devoluciones ALTER COLUMN invoice_id SET NOT NULL;
