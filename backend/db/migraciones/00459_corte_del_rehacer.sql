-- +goose Up
-- El corte de una venta que se anula para rehacerla (mes 23: CRT-12 y CRT-15
-- quedaban «en-cola» sin venta si se cancelaba el diálogo del corte, y el
-- taller los podía cortar sin que nadie los cobrara). Queda cancelado y con
-- la venta de la que salió: la nueva venta lo revive al atarlo, y si nadie
-- lo ata no se corta.
ALTER TABLE cutting_orders ADD COLUMN rehacer_de uuid REFERENCES orders(id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE cutting_orders DROP COLUMN rehacer_de;
