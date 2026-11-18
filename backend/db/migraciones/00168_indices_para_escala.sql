-- +goose NO TRANSACTION
-- +goose Up
-- Índices para cuando llegue el padrón de ISIS (tanda T8, «Escala antes de
-- migrar»): miles de clientes, años de cuenta corriente y de pedidos.
--
-- **CONCURRENTLY y sin transacción.** Las migraciones se corren a mano con la
-- aplicación andando; un CREATE INDEX común toma un candado que frena las
-- escrituras de la tabla mientras se arma, y con datos reales eso es el
-- mostrador sin poder vender un rato. CONCURRENTLY no frena a nadie, pero no
-- puede ir dentro de una transacción ni de a varios por sentencia: por eso
-- esta migración no tiene transacción y cada índice es una sentencia suelta.
-- IF NOT EXISTS para poder volver a correrla si algo la corta a mitad.
--
-- Número fijo, 00168: el rango 00160–00169 lo comparten las ramas que se
-- trabajan en paralelo, y «la primera libre» chocaba entre ellas.

-- El buscador del panel y la cartera comparan con `f_unaccent(col) ILIKE
-- '%…%'`: comodín adelante, así que solo sirve un GIN de trigramas (ver la
-- 00020). Estas son las columnas que se comparan y no tenían índice. Un OR
-- entre columnas usa índices solo si todas sus ramas tienen uno: con que
-- falte una, Postgres recorre la tabla entera.
CREATE INDEX CONCURRENTLY IF NOT EXISTS customers_telefono_busqueda_idx ON customers USING gin (f_unaccent(telefono) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS customers_email_busqueda_idx ON customers USING gin (f_unaccent(email) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS customers_rubro_busqueda_idx ON customers USING gin (f_unaccent(rubro) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_numero_busqueda_idx ON orders USING gin (f_unaccent(numero) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS quotes_numero_busqueda_idx ON quotes USING gin (f_unaccent(numero) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS cutting_orders_numero_busqueda_idx ON cutting_orders USING gin (f_unaccent(numero) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS suppliers_nombre_busqueda_idx ON suppliers USING gin (f_unaccent(nombre) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS suppliers_razon_busqueda_idx ON suppliers USING gin (f_unaccent(razon_social) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS suppliers_cuit_busqueda_idx ON suppliers USING gin (f_unaccent(cuit) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS suppliers_rubro_busqueda_idx ON suppliers USING gin (f_unaccent(rubro) gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_receptor_busqueda_idx ON invoices USING gin (f_unaccent(receptor_nombre) gin_trgm_ops);
-- El número de comprobante como lo escribe el buscador: «0003-00001234».
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_numero_busqueda_idx ON invoices
  USING gin ((lpad(punto_venta::text, 4, '0') || '-' || lpad(numero::text, 8, '0')) gin_trgm_ops);

-- Un teléfono o un CUIT se busca por sus dígitos (busqueda.Digitos). La
-- expresión tiene que ser **letra por letra** la de Digitos: si difiere en
-- algo, Postgres no la reconoce y vuelve a recorrer la tabla. Lo verifica
-- buscador/indices_test.go con EXPLAIN. Trigramas y no B-tree: se busca un
-- pedazo del número (LIKE '%…%'), y un B-tree no sirve con el comodín
-- adelante.
CREATE INDEX CONCURRENTLY IF NOT EXISTS customers_telefono_digitos_idx ON customers USING gin (regexp_replace(coalesce(telefono, ''), '\D', '', 'g') gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS customers_cuit_digitos_idx ON customers USING gin (regexp_replace(coalesce(cuit, ''), '\D', '', 'g') gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS suppliers_telefono_digitos_idx ON suppliers USING gin (regexp_replace(coalesce(telefono, ''), '\D', '', 'g') gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS suppliers_cuit_digitos_idx ON suppliers USING gin (regexp_replace(coalesce(cuit, ''), '\D', '', 'g') gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_telefono_digitos_idx ON orders USING gin (regexp_replace(coalesce(contacto_telefono, ''), '\D', '', 'g') gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS quotes_telefono_digitos_idx ON quotes USING gin (regexp_replace(coalesce(contacto_telefono, ''), '\D', '', 'g') gin_trgm_ops);

-- La cartera suma la cuenta corriente por cliente y busca, de cada deudor,
-- desde cuándo debe. Con el cliente, la fecha y el monto en el índice, las
-- dos cosas se leen del índice sin tocar la tabla.
CREATE INDEX CONCURRENTLY IF NOT EXISTS account_movements_cliente_fecha_idx ON account_movements (customer_id, created_at, id) INCLUDE (monto);

-- Los pedidos sin entregar del inicio: son pocos y la tabla crece sin tope.
-- `orders_estado_idx` no sirve para «NOT IN»; este índice parcial tiene
-- justamente esas filas y nada más.
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_abiertos_idx ON orders (customer_id) WHERE estado NOT IN ('entregado', 'cancelado');

-- La copia del mostrador pide «lo que cambió desde la última vez»: sin índice
-- sobre updated_at, cada caja recorría las cuatro tablas enteras cada diez
-- minutos aunque no hubiera cambiado nada.
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_updated_idx ON products (updated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_variants_updated_idx ON product_variants (updated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS price_list_items_updated_idx ON price_list_items (updated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS inventory_updated_idx ON inventory (updated_at);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS customers_telefono_busqueda_idx;
DROP INDEX CONCURRENTLY IF EXISTS customers_email_busqueda_idx;
DROP INDEX CONCURRENTLY IF EXISTS customers_rubro_busqueda_idx;
DROP INDEX CONCURRENTLY IF EXISTS orders_numero_busqueda_idx;
DROP INDEX CONCURRENTLY IF EXISTS quotes_numero_busqueda_idx;
DROP INDEX CONCURRENTLY IF EXISTS cutting_orders_numero_busqueda_idx;
DROP INDEX CONCURRENTLY IF EXISTS suppliers_nombre_busqueda_idx;
DROP INDEX CONCURRENTLY IF EXISTS suppliers_razon_busqueda_idx;
DROP INDEX CONCURRENTLY IF EXISTS suppliers_cuit_busqueda_idx;
DROP INDEX CONCURRENTLY IF EXISTS suppliers_rubro_busqueda_idx;
DROP INDEX CONCURRENTLY IF EXISTS invoices_receptor_busqueda_idx;
DROP INDEX CONCURRENTLY IF EXISTS invoices_numero_busqueda_idx;
DROP INDEX CONCURRENTLY IF EXISTS customers_telefono_digitos_idx;
DROP INDEX CONCURRENTLY IF EXISTS customers_cuit_digitos_idx;
DROP INDEX CONCURRENTLY IF EXISTS suppliers_telefono_digitos_idx;
DROP INDEX CONCURRENTLY IF EXISTS suppliers_cuit_digitos_idx;
DROP INDEX CONCURRENTLY IF EXISTS orders_telefono_digitos_idx;
DROP INDEX CONCURRENTLY IF EXISTS quotes_telefono_digitos_idx;
DROP INDEX CONCURRENTLY IF EXISTS account_movements_cliente_fecha_idx;
DROP INDEX CONCURRENTLY IF EXISTS orders_abiertos_idx;
DROP INDEX CONCURRENTLY IF EXISTS products_updated_idx;
DROP INDEX CONCURRENTLY IF EXISTS product_variants_updated_idx;
DROP INDEX CONCURRENTLY IF EXISTS price_list_items_updated_idx;
DROP INDEX CONCURRENTLY IF EXISTS inventory_updated_idx;
