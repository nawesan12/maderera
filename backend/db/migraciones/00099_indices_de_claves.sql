-- +goose Up
-- Las claves foráneas que se recorren en reportes y listados y no tenían
-- índice (revisión del 16/11/2026): la reposición y «meses sin vender» van
-- por order_items.variant_id; los listados por sucursal, por
-- orders/receipts/deliveries.branch_id; el pedido de un presupuesto, por
-- orders.quote_id. Con poco volumen no se nota; con el histórico de ISIS sí.
CREATE INDEX IF NOT EXISTS order_items_variant_idx ON order_items (variant_id);
CREATE INDEX IF NOT EXISTS quote_items_variant_idx ON quote_items (variant_id);
CREATE INDEX IF NOT EXISTS orders_branch_idx ON orders (branch_id);
CREATE INDEX IF NOT EXISTS orders_quote_idx ON orders (quote_id);
CREATE INDEX IF NOT EXISTS orders_seller_idx ON orders (seller_id);
CREATE INDEX IF NOT EXISTS receipts_branch_idx ON receipts (branch_id);
CREATE INDEX IF NOT EXISTS deliveries_branch_idx ON deliveries (branch_id);
CREATE INDEX IF NOT EXISTS invoices_punto_venta_idx ON invoices (punto_venta_id);
CREATE INDEX IF NOT EXISTS cutting_orders_order_idx ON cutting_orders (order_id);
CREATE INDEX IF NOT EXISTS cutting_orders_customer_idx ON cutting_orders (customer_id);
CREATE INDEX IF NOT EXISTS stock_reservations_branch_idx ON stock_reservations (branch_id);

-- +goose Down
DROP INDEX IF EXISTS stock_reservations_branch_idx;
DROP INDEX IF EXISTS cutting_orders_customer_idx;
DROP INDEX IF EXISTS cutting_orders_order_idx;
DROP INDEX IF EXISTS invoices_punto_venta_idx;
DROP INDEX IF EXISTS deliveries_branch_idx;
DROP INDEX IF EXISTS receipts_branch_idx;
DROP INDEX IF EXISTS orders_seller_idx;
DROP INDEX IF EXISTS orders_quote_idx;
DROP INDEX IF EXISTS orders_branch_idx;
DROP INDEX IF EXISTS quote_items_variant_idx;
DROP INDEX IF EXISTS order_items_variant_idx;
