-- La numeración de pedidos, cortes y recibos (internal/numeracion y
-- lib/dal/numeracion-ventas.ts) toma el máximo número usado con
-- max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint), dentro del
-- candado de la serie. Sin índice eso recorre la tabla entera en cada venta,
-- y como corre con el candado tomado, es el techo de ventas por segundo de
-- todo el negocio: con 6000 pedidos, unas 25 por segundo (benchmark de la
-- tanda 5). Con un índice sobre la misma expresión, el máximo sale del
-- índice en una lectura. La consulta no cambia: los dos lados (TS y Go)
-- numeran igual y los dos usan el índice.

-- +goose Up
CREATE INDEX IF NOT EXISTS orders_numero_serie_idx
	ON orders ((nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint));
CREATE INDEX IF NOT EXISTS cutting_orders_numero_serie_idx
	ON cutting_orders ((nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint));
CREATE INDEX IF NOT EXISTS receipts_numero_serie_idx
	ON receipts ((nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint));

-- +goose Down
DROP INDEX IF EXISTS receipts_numero_serie_idx;
DROP INDEX IF EXISTS cutting_orders_numero_serie_idx;
DROP INDEX IF EXISTS orders_numero_serie_idx;
