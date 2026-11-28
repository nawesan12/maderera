-- +goose Up
-- La deuda que se carga a mano en la cuenta de un cliente, sin comprobante
-- (el saldo del sistema anterior, una nota de débito suelta): al circuito B,
-- como hasta ahora, o al archivo del estudio contra Saldos iniciales y
-- ajustes, y su cobro la cancela ahí (mes simulado, M3S3-002). Arranca como
-- estaba.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('deuda_sin_comprobante', 'circuito_b', 'La deuda cargada a mano en la cuenta de un cliente: circuito_b o saldo_inicial (M3S3-002)')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'deuda_sin_comprobante';
