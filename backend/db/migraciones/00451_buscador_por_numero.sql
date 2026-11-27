-- +goose Up
-- El buscador del panel encuentra recibos, remitos y cheques por su número
-- (mes simulado, M2S1-096, M2S2-132): «REC-0005», «REM-0015», «00045678».
-- Con trigramas, como el resto de los números del buscador, para que una
-- tecla no recorra la tabla entera.
CREATE INDEX IF NOT EXISTS receipts_numero_busqueda_idx ON receipts USING gin (f_unaccent(numero) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS deliveries_numero_busqueda_idx ON deliveries USING gin (f_unaccent(numero) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cheques_numero_busqueda_idx ON cheques USING gin (f_unaccent(numero) gin_trgm_ops);

-- +goose Down
DROP INDEX IF EXISTS cheques_numero_busqueda_idx;
DROP INDEX IF EXISTS deliveries_numero_busqueda_idx;
DROP INDEX IF EXISTS receipts_numero_busqueda_idx;
