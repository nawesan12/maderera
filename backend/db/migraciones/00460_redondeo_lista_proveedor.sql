-- +goose Up
-- A qué redondea el precio que propone la lista del proveedor (mes 23: el
-- MDF quedaba en $ 81.876,92). Arranca en «centavos», que es como funciona;
-- «peso», «decena» y «centena» suben, como el redondeo del ajuste masivo.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('redondeo_lista_proveedor', 'centavos', 'A qué redondea el precio de la lista del proveedor: centavos, peso, decena o centena')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'redondeo_lista_proveedor';
