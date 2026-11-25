-- +goose Up
-- Las dos sucursales de siempre, como filas (comité del 25/11). Desde que el
-- stock, el catálogo, /sucursales y «Ventas por sucursal» leen de branches,
-- una base recién migrada —como la de producción, vacía— quedaba sin
-- sucursales: «0 locales», el inicio sin ventas por sucursal y ninguna
-- pantalla para cargarlas, porque lo que se publica de cada local es una
-- constante (lib/sucursales.ts) y la fila es solo la identidad relacional.
-- Hasta acá las ponía `npm run db:seed`, que no se corre en producción.
--
-- Con ON CONFLICT (slug): si la base ya las tiene (la sembraron, o un
-- servidor que ya andaba), no se tocan ni se duplican. Los slugs son los que
-- usa el código (catalogo.slugCentral, slugAserradero y lib/sucursales.ts).
INSERT INTO branches (slug, name, sort_order) VALUES
	('casa-central', 'Casa Central', 0),
	('aserradero', 'Aserradero', 1)
ON CONFLICT (slug) DO NOTHING;

-- +goose Down
-- No se borran: de su id cuelgan el stock, los pedidos y los turnos.
SELECT 1;
