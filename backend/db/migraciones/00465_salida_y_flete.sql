-- +goose Up
-- Recorrido M4-077 y M4-078: dos reglas del despacho de un envío, con lo de
-- siempre de arranque. flete_sin_cotizar: «avisa» (sale, preguntado antes) o
-- «frena» (no sale hasta cotizarlo o «Sin cargo»). despacho_contra_entrega:
-- «con_pin» (el depósito despacha el envío en efectivo con el PIN de un
-- admin) o «sin_pin» (sale sin PIN y queda «A cobrar» en el reparto).
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('flete_sin_cotizar', 'avisa', 'El envío con el flete sin cotizar: avisa o frena'),
  ('despacho_contra_entrega', 'con_pin', 'El envío en efectivo contra entrega: con_pin o sin_pin')
ON CONFLICT (clave) DO NOTHING;

-- M4-114: quién firmó con su PIN la salida sin cobrar de un pedido y la
-- anulación de un recibo. Se descartaba el nombre: el historial y «El
-- personal» no sabían quién había autorizado.
ALTER TABLE orders
  ADD COLUMN salida_autorizada_por text REFERENCES "user"(id),
  ADD COLUMN salida_sin_cobrar numeric(12, 2),
  ADD COLUMN salida_autorizada_at timestamptz;
ALTER TABLE receipts
  ADD COLUMN anulacion_autorizada_por text REFERENCES "user"(id);

-- +goose Down
ALTER TABLE receipts DROP COLUMN anulacion_autorizada_por;
ALTER TABLE orders DROP COLUMN salida_autorizada_at, DROP COLUMN salida_sin_cobrar, DROP COLUMN salida_autorizada_por;
DELETE FROM site_settings WHERE clave IN ('flete_sin_cotizar', 'despacho_contra_entrega');
