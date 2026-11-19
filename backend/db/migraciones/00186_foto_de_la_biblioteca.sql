-- +goose Up
-- De qué archivo de la biblioteca de fotos salió cada foto de producto
-- (backend/internal/fotos). Con esto el enganche es «el producto no tiene
-- todavía esta foto» y no «no tiene ninguna»: si un producto tiene la
-- melamina en aglomerado y en MDF, cada medida suma la suya. El índice único
-- es lo que impide que dos lotes al mismo tiempo la pongan dos veces.
-- Las fotos subidas a mano quedan en NULL.
-- +goose StatementBegin
ALTER TABLE product_images ADD COLUMN origen_biblioteca text;
-- +goose StatementEnd
-- La copia de la 00150 tiene la misma forma que product_images (su Down
-- devuelve las filas con `SELECT *`): la columna va en las dos.
-- +goose StatementBegin
ALTER TABLE IF EXISTS product_images_rubro_00150 ADD COLUMN IF NOT EXISTS origen_biblioteca text;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX product_images_origen_biblioteca_idx
  ON product_images (product_id, origen_biblioteca) WHERE origen_biblioteca IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS product_images_origen_biblioteca_idx;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE product_images DROP COLUMN IF EXISTS origen_biblioteca;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE IF EXISTS product_images_rubro_00150 DROP COLUMN IF EXISTS origen_biblioteca;
-- +goose StatementEnd
