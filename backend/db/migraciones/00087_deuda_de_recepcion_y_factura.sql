-- +goose Up

-- La deuda que cargó cada recepción queda atada a la recepción. Así la
-- factura de compra que cubre esa recepción sabe cuánto ya está en la cuenta
-- del proveedor y carga solo la diferencia: antes la recepción cargaba el
-- total con IVA y la factura lo volvía a cargar, y una orden de $1.210
-- recibida y facturada dejaba un saldo de $2.420.
ALTER TABLE supplier_movements ADD COLUMN goods_receipt_id uuid REFERENCES goods_receipts(id) ON DELETE SET NULL;
CREATE INDEX supplier_movements_receipt_idx ON supplier_movements (goods_receipt_id) WHERE goods_receipt_id IS NOT NULL;

-- Las de antes: el movimiento de la confirmación se escribió en la misma
-- transacción que confirmada_at, con el mismo now(). Las anuladas no hace
-- falta atarlas: a una anulada no se le vincula factura.
UPDATE supplier_movements m SET goods_receipt_id = g.id
FROM goods_receipts g
WHERE g.estado = 'confirmada' AND m.goods_receipt_id IS NULL
  AND m.supplier_id = g.supplier_id AND m.tipo = 'factura' AND m.detalle = 'Recepción de mercadería'
  AND m.created_at = g.confirmada_at;

-- Una recepción la cubre una sola factura.
CREATE UNIQUE INDEX purchase_invoices_receipt_idx ON purchase_invoices (receipt_id) WHERE receipt_id IS NOT NULL;

-- +goose Down
DROP INDEX purchase_invoices_receipt_idx;
DROP INDEX supplier_movements_receipt_idx;
ALTER TABLE supplier_movements DROP COLUMN goods_receipt_id;
