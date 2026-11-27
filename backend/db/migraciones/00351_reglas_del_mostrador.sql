-- +goose Up
-- Dos políticas del mostrador que encontró el mes simulado y que decide la
-- dueña (/admin/reglas). Arrancan con lo que el sistema hacía hasta hoy.
--
-- descuento_con_escala (M2S2-018): el descuento tipeado por el vendedor
--   reemplaza al de la forma de pago (el 10 % de efectivo) o se suma.
-- redondeo_efectivo (M2S1-180): lo que se paga todo en efectivo va con sus
--   centavos o al peso, a favor del cliente.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('descuento_con_escala', 'reemplaza', 'El descuento tipeado y el de la forma de pago: reemplaza o suma (M2S2-018)'),
  ('redondeo_efectivo', 'no', 'Lo pagado todo en efectivo: no (con centavos) o al_peso (M2S1-180)')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave IN ('descuento_con_escala', 'redondeo_efectivo');
