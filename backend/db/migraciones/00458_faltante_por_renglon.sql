-- +goose Up
-- Lo que no llegó de un traslado, renglón por renglón (mes 23: era una sola
-- elección para todas las medidas, y no se podía decir que una se perdió y
-- otra vuelve). stock_traslados.faltante queda para cuando todas van igual.
ALTER TABLE stock_traslado_items ADD COLUMN faltante text CHECK (faltante IN ('origen', 'perdido'));

-- +goose Down
ALTER TABLE stock_traslado_items DROP COLUMN faltante;
