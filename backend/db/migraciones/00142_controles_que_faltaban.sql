-- +goose Up
-- Lo que la revisión de T3 encontró abierto (18/11/2026).

-- credito_sin_autorizar: lo que una venta sin conexión cargó a cuenta
-- corriente pasado el límite o con mora, sin PIN. Ya ocurrió y no se
-- rechaza (como el precio), pero hasta acá no quedaba marcado en ningún lado:
-- el dueño no se enteraba de la deuda nueva de un moroso.
ALTER TABLE orders ADD COLUMN credito_sin_autorizar numeric(12,2) NOT NULL DEFAULT 0;

-- El precio de lista de cada renglón al emitir el presupuesto. Con él, pasar
-- a pedido un presupuesto vigente mide lo dejado de cobrar contra la lista
-- del día en que se prometió el precio, y no contra la de hoy (que puede
-- haber subido): el presupuesto armado bajo la lista ya no pasa sin PIN.
ALTER TABLE quote_items ADD COLUMN precio_lista numeric(12,2);

-- +goose Down
ALTER TABLE quote_items DROP COLUMN precio_lista;
ALTER TABLE orders DROP COLUMN credito_sin_autorizar;
