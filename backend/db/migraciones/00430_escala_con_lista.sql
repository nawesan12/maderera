-- +goose Up
-- En la tienda, si el precio de la lista propia (la del profesional, que ya
-- es de contado) suma además el descuento por medio de pago (mes simulado,
-- M3S3-020: el MDF de 3 mm quedaba 23,5 % abajo del público). Arranca en
-- «si», que es como funcionaba: desplegar esto no cambia nada.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('escala_con_lista', 'si', 'En la tienda, la lista propia suma el descuento por medio de pago: si o no (M3S3-020)')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'escala_con_lista';
