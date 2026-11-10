-- +goose Up
-- La primera entrega del sitio va sin tienda (notas del 9/11/2026): la
-- clienta todavía tiene que cargar el inventario. Dos interruptores del panel,
-- los dos apagados:
--   tienda_activa: precios, carrito y compra en el sitio. Apagada, la API
--     pública no devuelve ningún precio y el carrito no acepta nada.
--   stock_visible: la disponibilidad en el sitio. El stock de producción está
--     en cero hasta que se cargue, y mostrarlo diría «sin stock» en todo.
-- Si la fila no existe, la tienda cuenta como encendida: es lo que hacía el
-- sitio antes de esta migración.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
	('tienda_activa', 'no', 'Tienda online: precios, carrito y compra en el sitio'),
	('stock_visible', 'no', 'Disponibilidad de los productos en el sitio')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave IN ('tienda_activa', 'stock_visible');
