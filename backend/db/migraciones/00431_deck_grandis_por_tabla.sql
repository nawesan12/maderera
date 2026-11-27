-- +goose Up
-- La ficha del Deck Grandis decía «Se vende por metro cuadrado» en la
-- descripción y «$ 17.880 por tabla» abajo (mes simulado, M2S4-054). Se
-- vende por tabla, como dice la semilla: se corrige solo esa frase y solo si
-- el producto no se vende por metro cuadrado.
UPDATE products
SET description = replace(description, 'Se vende por metro cuadrado.', 'Se vende por tabla.'), updated_at = now()
WHERE slug = 'deck-grandis'
  AND forma_de_venta <> 'metro_cuadrado'
  AND description LIKE '%Se vende por metro cuadrado.%';

-- +goose Down
SELECT 1;
