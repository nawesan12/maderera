-- +goose Up
-- La mercadería que se le devuelve al proveedor con su nota de crédito
-- (M3S2-016): la nota bajaba la deuda y el IVA, pero la placa devuelta seguía
-- en el stock con su costo y había que pedir un ajuste aparte, sin atar a la
-- nota. Cada renglón sale del stock de la sucursal donde entró, al costo con
-- que entró; anular la nota lo devuelve al stock.
CREATE TABLE purchase_return_items (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	purchase_invoice_id uuid NOT NULL REFERENCES purchase_invoices (id) ON DELETE CASCADE,
	goods_receipt_item_id uuid NOT NULL REFERENCES goods_receipt_items (id),
	variant_id uuid NOT NULL REFERENCES product_variants (id),
	branch_id uuid NOT NULL REFERENCES branches (id),
	cantidad numeric(14, 4) NOT NULL CHECK (cantidad > 0),
	costo_unitario numeric(14, 4) NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX purchase_return_items_factura_idx ON purchase_return_items (purchase_invoice_id);
CREATE INDEX purchase_return_items_renglon_idx ON purchase_return_items (goods_receipt_item_id);

-- +goose Down
DROP TABLE purchase_return_items;
