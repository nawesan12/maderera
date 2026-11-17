-- +goose Up
-- La revisión de compras del 17/11/2026.
--
-- Una factura de compra se puede anular (cargada dos veces, a otro
-- proveedor, con los importes cruzados): queda con su motivo, deja de contar
-- en el libro IVA y devuelve lo que movió en la cuenta del proveedor. La
-- numeración pasa a ser única entre las vivas, así la correcta se vuelve a
-- cargar con el mismo número.
ALTER TABLE purchase_invoices
  ADD COLUMN anulada_at timestamptz,
  ADD COLUMN motivo_anulacion text,
  ADD COLUMN anulada_por_user_id text REFERENCES "user"(id),
  -- Las percepciones por impuesto: el libro IVA digital las pide separadas.
  -- `percepciones` sigue siendo el total (lo que suma la factura); en las de
  -- antes las dos quedan en cero, sin discriminar.
  ADD COLUMN percepcion_iva numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN percepcion_iibb numeric(12,2) NOT NULL DEFAULT 0;

DROP INDEX purchase_invoices_numeracion_idx;
CREATE UNIQUE INDEX purchase_invoices_numeracion_idx ON purchase_invoices (supplier_id, tipo, punto_venta, numero)
  WHERE anulada_at IS NULL;

-- Cada movimiento de la cuenta del proveedor sabe de qué factura o de qué
-- pago salió: la ficha lleva a él, y anular una factura devuelve justo lo que
-- ella cargó.
ALTER TABLE supplier_movements
  ADD COLUMN purchase_invoice_id uuid REFERENCES purchase_invoices(id) ON DELETE SET NULL,
  ADD COLUMN supplier_payment_id uuid REFERENCES supplier_payments(id) ON DELETE SET NULL;
CREATE INDEX supplier_movements_invoice_idx ON supplier_movements (purchase_invoice_id) WHERE purchase_invoice_id IS NOT NULL;
CREATE INDEX supplier_movements_payment_idx ON supplier_movements (supplier_payment_id) WHERE supplier_payment_id IS NOT NULL;

-- Los de antes: la factura (o el pago) y su movimiento se escribieron en la
-- misma transacción, así que comparten el created_at (now() es el de la
-- transacción). La anulación de un pago, con su anulado_at.
UPDATE supplier_movements m SET purchase_invoice_id = f.id
FROM purchase_invoices f
WHERE m.purchase_invoice_id IS NULL AND m.goods_receipt_id IS NULL AND m.supplier_id = f.supplier_id
  AND m.created_at = f.created_at AND m.tipo IN ('factura', 'nota_credito', 'nota_debito', 'ajuste');
UPDATE supplier_movements m SET supplier_payment_id = p.id
FROM supplier_payments p
WHERE m.supplier_payment_id IS NULL AND m.supplier_id = p.supplier_id
  AND ((m.tipo = 'pago' AND m.created_at = p.created_at) OR (m.tipo = 'ajuste' AND m.created_at = p.anulado_at));

-- El efectivo de un pago a proveedor sale de la caja del turno, como un
-- gasto; anular el pago lo devuelve.
ALTER TABLE cash_movements
  ADD COLUMN supplier_payment_id uuid REFERENCES supplier_payments(id) ON DELETE SET NULL;
CREATE INDEX cash_movements_pago_proveedor_idx ON cash_movements (supplier_payment_id) WHERE supplier_payment_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS cash_movements_pago_proveedor_idx;
ALTER TABLE cash_movements DROP COLUMN IF EXISTS supplier_payment_id;
DROP INDEX IF EXISTS supplier_movements_payment_idx;
DROP INDEX IF EXISTS supplier_movements_invoice_idx;
ALTER TABLE supplier_movements DROP COLUMN IF EXISTS supplier_payment_id, DROP COLUMN IF EXISTS purchase_invoice_id;
DROP INDEX purchase_invoices_numeracion_idx;
CREATE UNIQUE INDEX purchase_invoices_numeracion_idx ON purchase_invoices (supplier_id, tipo, punto_venta, numero);
ALTER TABLE purchase_invoices DROP COLUMN IF EXISTS percepcion_iibb, DROP COLUMN IF EXISTS percepcion_iva,
  DROP COLUMN IF EXISTS anulada_por_user_id, DROP COLUMN IF EXISTS motivo_anulacion, DROP COLUMN IF EXISTS anulada_at;
