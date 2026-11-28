-- +goose Up
-- Qué sucursales cuentan para «Para reponer» (recorrido M4-079: con un
-- mínimo puesto en el Aserradero para la laca, que no maneja, figuraban 38 de
-- 40 medidas para reponer). Arranca en «con_minimo», como funciona: cualquier
-- sucursal con mínimo; «las_que_la_manejan», solo las que tienen o movieron
-- esa medida.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('reponer_por_sucursal', 'con_minimo', 'Qué sucursales cuentan para reponer: con_minimo o las_que_la_manejan')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'reponer_por_sucursal';
