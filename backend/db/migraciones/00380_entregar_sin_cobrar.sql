-- +goose Up
-- Mes simulado 2 (M2S1-018, M2S1-019): el depósito soltaba mercadería sin
-- cobrar con un toque. Desde ahora el depósito pide el PIN de un admin; la
-- regla dice si además lo pide quien vende cuando el cliente no tiene
-- cuenta corriente o la deuda pasa su límite. Arranca en «deposito».
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('entregar_sin_cobrar', 'deposito', 'Quién pide el PIN para entregar sin cobrar: deposito o fuera_de_la_cuenta')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'entregar_sin_cobrar';
