-- +goose Up
-- Lo que pidió el mes simulado en compras y pagos (noviembre de 2026).

-- H060: una recepción anulada no ocupa su número de remito. El índice
-- frenaba cargar dos veces la misma entrega (duplicar el stock y corromper
-- el costo promedio), pero contaba también las anuladas, y el remito real se
-- tenía que cargar con un número inventado.
DROP INDEX IF EXISTS goods_receipts_remito_idx;
CREATE UNIQUE INDEX goods_receipts_remito_idx ON goods_receipts (supplier_id, numero_remito) WHERE estado <> 'anulada';

-- H199: una factura de compra cubre uno o varios remitos (el proveedor que
-- factura la quincena). purchase_invoices.receipt_id sigue siendo el primero,
-- para lo que ya lo lee; la lista entera va acá, una recepción en una sola
-- factura viva.
CREATE TABLE purchase_invoice_receipts (
	purchase_invoice_id uuid NOT NULL REFERENCES purchase_invoices (id) ON DELETE CASCADE,
	goods_receipt_id uuid NOT NULL REFERENCES goods_receipts (id),
	PRIMARY KEY (purchase_invoice_id, goods_receipt_id)
);
CREATE UNIQUE INDEX purchase_invoice_receipts_recepcion_idx ON purchase_invoice_receipts (goods_receipt_id);
INSERT INTO purchase_invoice_receipts (purchase_invoice_id, goods_receipt_id)
SELECT id, receipt_id FROM purchase_invoices WHERE receipt_id IS NOT NULL AND anulada_at IS NULL
ON CONFLICT DO NOTHING;

-- H292/H352: la nota de crédito del proveedor se aplica a la factura que
-- corrige. Aplicada, baja el saldo de esa factura (no se paga lo que el
-- proveedor ya devolvió); sin aplicar, es saldo a favor.
ALTER TABLE purchase_invoices ADD COLUMN aplica_a_id uuid REFERENCES purchase_invoices (id);
CREATE INDEX purchase_invoices_aplica_a_idx ON purchase_invoices (aplica_a_id) WHERE aplica_a_id IS NOT NULL;

-- H293/H337: el cheque que le dimos al proveedor y rebotó es una deuda que
-- se paga como una factura. El ajuste que reabre la deuda queda atado al
-- cheque, y el pago que lo repone se imputa a él.
ALTER TABLE supplier_movements ADD COLUMN cheque_id uuid REFERENCES cheques (id);
UPDATE supplier_movements m SET cheque_id = c.id
FROM cheques c
WHERE m.tipo = 'ajuste' AND m.cheque_id IS NULL AND m.referencia = c.numero AND c.estado = 'rechazado'
  AND m.detalle LIKE '%rechazado por el banco%';
CREATE TABLE supplier_payment_cheques (
	payment_id uuid NOT NULL REFERENCES supplier_payments (id) ON DELETE CASCADE,
	cheque_id uuid NOT NULL REFERENCES cheques (id),
	importe numeric(14, 2) NOT NULL,
	PRIMARY KEY (payment_id, cheque_id)
);

-- +goose Down
DROP TABLE supplier_payment_cheques;
ALTER TABLE supplier_movements DROP COLUMN cheque_id;
ALTER TABLE purchase_invoices DROP COLUMN aplica_a_id;
DROP TABLE purchase_invoice_receipts;
DROP INDEX goods_receipts_remito_idx;
CREATE UNIQUE INDEX goods_receipts_remito_idx ON goods_receipts (supplier_id, numero_remito);
