-- +goose Up
-- Cómo arranca el interruptor «Activo» en el alta de un producto (mes
-- simulado, M3S2-036: se publicaba apenas se guardaba el primer paso, sin
-- foto ni precio). Apagado, el producto tampoco sale en el buscador del
-- mostrador, así que es una decisión de la dueña. Arranca en «activo», que
-- es como funcionaba: desplegar esto no cambia nada.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('alta_de_producto', 'activo', 'El alta de un producto arranca activa o inactiva: activo o inactivo (M3S2-036)')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'alta_de_producto';
