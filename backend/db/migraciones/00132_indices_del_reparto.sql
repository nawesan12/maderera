-- +goose Up
-- Los índices que el reparto de los recibos necesita (cobros.eventosSQL,
-- revisión del comité del 18/11/2026). La clave de cada recibo sin cliente
-- sale de invoice_payments por receipt_id, y los pagos sin recibo se
-- reconocen porque ninguna parte de recibo los nombra (receipt_parts por
-- payment_id): sin índice, cada recibo recorría las dos tablas enteras
-- dentro de la transacción del cobro, con el candado de los recibos tomado.
CREATE INDEX invoice_payments_receipt_idx ON invoice_payments (receipt_id) WHERE receipt_id IS NOT NULL;
CREATE INDEX receipt_parts_payment_idx ON receipt_parts (payment_id) WHERE payment_id IS NOT NULL;

-- +goose Down
DROP INDEX invoice_payments_receipt_idx;
DROP INDEX receipt_parts_payment_idx;
