-- Índices para la búsqueda del catálogo y del panel.
--
-- La búsqueda usa `unaccent(columna) ILIKE '%termino%'`: comodín al principio y
-- sobre una expresión, así que ningún índice B-tree la puede ayudar. Lo que
-- sirve es un GIN de trigramas.
--
-- `unaccent` es STABLE —depende del diccionario— y Postgres no indexa
-- expresiones que no sean IMMUTABLE. `f_unaccent` es el envoltorio estándar
-- para prometerle que ese diccionario no cambia; la búsqueda tiene que llamar a
-- este y no a `unaccent` directo, o el índice no se usa.
--
-- Medido sobre 6.000 productos: 12,4 ms de barrido secuencial contra 3,3 ms por
-- índice, en una sola columna. La búsqueda real toca cuatro.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
--> statement-breakpoint

-- Catálogo público: es la búsqueda que más se usa y la que ve el cliente.
CREATE INDEX IF NOT EXISTS products_nombre_busqueda_idx ON products USING gin (f_unaccent(name) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS products_descripcion_busqueda_idx ON products USING gin (f_unaccent(description) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS products_marca_busqueda_idx ON products USING gin (f_unaccent(brand) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS products_subcategoria_busqueda_idx ON products USING gin (f_unaccent(subcategory) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_variants_sku_busqueda_idx ON product_variants USING gin (f_unaccent(sku) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_variants_label_busqueda_idx ON product_variants USING gin (f_unaccent(label) gin_trgm_ops);
--> statement-breakpoint

-- Panel: clientes es la otra búsqueda de todos los días, y la que más crece con
-- la migración del sistema anterior.
CREATE INDEX IF NOT EXISTS customers_nombre_busqueda_idx ON customers USING gin (f_unaccent(nombre) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customers_razon_busqueda_idx ON customers USING gin (f_unaccent(razon_social) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customers_cuit_busqueda_idx ON customers USING gin (f_unaccent(cuit) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_contacto_busqueda_idx ON orders USING gin (f_unaccent(contacto_nombre) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotes_contacto_busqueda_idx ON quotes USING gin (f_unaccent(contacto_nombre) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cutting_orders_contacto_busqueda_idx ON cutting_orders USING gin (f_unaccent(contacto_nombre) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cutting_orders_material_busqueda_idx ON cutting_orders USING gin (f_unaccent(material_descripcion) gin_trgm_ops);
