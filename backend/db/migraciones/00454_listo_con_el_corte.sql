-- +goose Up
-- Qué pedido pasa solo a «listo» cuando termina su último corte (mes
-- simulado 2, M2S3-020: un pedido del panel con CRT-28 terminado seguía
-- «Preparando» y nadie se enteraba). Arranca en «mostrador», que es como
-- funcionaba: los de otro origen los marca listos el depósito.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('listo_con_el_corte', 'mostrador', 'Qué pedido pasa solo a listo con su último corte terminado: mostrador o todos (M2S3-020)')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'listo_con_el_corte';
