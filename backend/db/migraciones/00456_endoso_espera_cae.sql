-- +goose Up
-- El cheque de una venta con su factura esperando el CAE (mes simulado 2,
-- M2S2-040). Es blanco: su cobro ya está en el archivo del estudio, contra
-- Anticipos o la transitoria de «asiento_sin_cae». Arranca en «si», que es
-- como funciona: se endosa a una factura A. «al_cae» lo deja en la cartera
-- hasta que llegue el CAE.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('endoso_espera_cae', 'si', 'Si el cheque de una venta que espera el CAE se endosa: si o al_cae (M2S2-040)')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'endoso_espera_cae';
