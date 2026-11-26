-- +goose Up
-- Las pasadas de un corte que se suman a su pedido (H184): cada renglón dice
-- de qué corte es, así el otro corte del mismo pedido sigue cobrando las
-- suyas aparte. Si el pedido ya no se puede tocar (facturado, cobrado o en
-- la cuenta corriente), van a un pedido aparte, el «cargo» del corte.
ALTER TABLE order_items ADD COLUMN cutting_order_id uuid REFERENCES cutting_orders(id) ON DELETE SET NULL;
CREATE INDEX order_items_corte_idx ON order_items (cutting_order_id) WHERE cutting_order_id IS NOT NULL;
ALTER TABLE cutting_orders ADD COLUMN cargo_order_id uuid REFERENCES orders(id) ON DELETE SET NULL;

-- El remito de una reposición sin cargo (H321): sale del pedido que la
-- originó, sin renglones del pedido (lo que se entrega son las piezas del
-- corte), y se firma con el dedo como cualquier remito. Uno vivo por
-- reposición.
ALTER TABLE deliveries ADD COLUMN cutting_order_id uuid REFERENCES cutting_orders(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX deliveries_reposicion_idx ON deliveries (cutting_order_id)
	WHERE cutting_order_id IS NOT NULL AND estado <> 'anulada';

-- +goose Down
DROP INDEX deliveries_reposicion_idx;
ALTER TABLE deliveries DROP COLUMN cutting_order_id;
ALTER TABLE cutting_orders DROP COLUMN cargo_order_id;
DROP INDEX order_items_corte_idx;
ALTER TABLE order_items DROP COLUMN cutting_order_id;
