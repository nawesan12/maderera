-- +goose Up
-- El recibo que cobra un pedido queda atado a ese pedido (revisión de T2,
-- 18/11/2026). Una seña cobrada desde la ficha del cliente con «Cobro del
-- pedido N» no se descontaba de lo que faltaba cobrar: el reparto pedía el
-- total entero y «Me deben» lo sumaba otra vez. Con la columna,
-- fragmentos.SinCobrarDelPedido resta los recibos vivos del pedido igual que
-- resta los cobros en línea.
ALTER TABLE receipts ADD COLUMN order_id uuid REFERENCES orders(id) ON DELETE SET NULL;
CREATE INDEX receipts_order_id_idx ON receipts (order_id) WHERE order_id IS NOT NULL;

-- +goose Down
DROP INDEX receipts_order_id_idx;
ALTER TABLE receipts DROP COLUMN order_id;
