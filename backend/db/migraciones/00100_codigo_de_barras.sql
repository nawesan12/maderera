-- +goose Up
-- El código de barras de cada medida, para buscarla con el lector en el
-- mostrador y en el stock. Uno por medida y sin repetir: dos medidas con el
-- mismo código harían que el lector agregue la equivocada.
ALTER TABLE product_variants ADD COLUMN codigo_barras text;
CREATE UNIQUE INDEX product_variants_codigo_barras_idx ON product_variants (codigo_barras) WHERE codigo_barras IS NOT NULL;

-- +goose Down
DROP INDEX product_variants_codigo_barras_idx;
ALTER TABLE product_variants DROP COLUMN codigo_barras;
