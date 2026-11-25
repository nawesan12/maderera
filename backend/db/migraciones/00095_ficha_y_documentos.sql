-- +goose Up
-- La ficha de producto más rica (notas del 9/11/2026): para qué sirve y cómo
-- se cuida, en texto con el formato simple de lib/markdown.ts.
ALTER TABLE products ADD COLUMN usos text, ADD COLUMN cuidados text;

-- Los documentos técnicos atados a un producto o a una categoría entera: la
-- ficha muestra los suyos y los de su categoría.
CREATE TABLE technical_document_targets (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	document_id uuid NOT NULL REFERENCES technical_documents(id) ON DELETE CASCADE,
	product_id uuid REFERENCES products(id) ON DELETE CASCADE,
	category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
	CHECK ((product_id IS NULL) <> (category_id IS NULL))
);
CREATE UNIQUE INDEX technical_document_targets_producto ON technical_document_targets (document_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX technical_document_targets_categoria ON technical_document_targets (document_id, category_id) WHERE category_id IS NOT NULL;
CREATE INDEX technical_document_targets_por_producto ON technical_document_targets (product_id);
CREATE INDEX technical_document_targets_por_categoria ON technical_document_targets (category_id);

-- +goose Down
DROP TABLE technical_document_targets;
ALTER TABLE products DROP COLUMN usos, DROP COLUMN cuidados;
