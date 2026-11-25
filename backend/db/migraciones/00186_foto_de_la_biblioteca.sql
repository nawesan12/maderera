-- +goose Up
-- De qué archivo de la biblioteca de fotos salió cada foto de producto
-- (backend/internal/fotos). Con esto el enganche es «el producto no tiene
-- todavía esta foto» y no «no tiene ninguna»: si un producto tiene la
-- melamina en aglomerado y en MDF, cada medida suma la suya. El índice único
-- es lo que impide que dos lotes al mismo tiempo la pongan dos veces.
-- Las fotos subidas a mano quedan en NULL.
--
-- `variant_id` es la medida que muestra la foto: la ficha cambia de foto al
-- elegir otra medida (con «MDF» elegido se veía el canto del aglomerado).
-- Si la medida se borra, la foto queda como foto general del producto.
-- +goose StatementBegin
ALTER TABLE product_images
  ADD COLUMN origen_biblioteca text,
  ADD COLUMN variant_id uuid REFERENCES product_variants (id) ON DELETE SET NULL;
-- +goose StatementEnd
-- La copia de la 00150 tiene la misma forma que product_images (su Down
-- devuelve las filas con `SELECT *`): las columnas van en las dos.
-- +goose StatementBegin
ALTER TABLE IF EXISTS product_images_rubro_00150
  ADD COLUMN IF NOT EXISTS origen_biblioteca text,
  ADD COLUMN IF NOT EXISTS variant_id uuid;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX product_images_origen_biblioteca_idx
  ON product_images (product_id, origen_biblioteca) WHERE origen_biblioteca IS NOT NULL;
-- +goose StatementEnd
-- Las fotos de la biblioteca que la clienta borró de un producto: ni crear la
-- medida otra vez ni `mjbj fotos adjuntar` las vuelven a poner.
-- +goose StatementBegin
CREATE TABLE fotos_biblioteca_descartadas (
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  origen text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, origen)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS fotos_biblioteca_descartadas;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS product_images_origen_biblioteca_idx;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE product_images DROP COLUMN IF EXISTS origen_biblioteca, DROP COLUMN IF EXISTS variant_id;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE IF EXISTS product_images_rubro_00150 DROP COLUMN IF EXISTS origen_biblioteca, DROP COLUMN IF EXISTS variant_id;
-- +goose StatementEnd
