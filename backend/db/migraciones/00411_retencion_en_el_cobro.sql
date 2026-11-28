-- +goose Up
-- La retención que trae el cliente con el pago, dentro del mismo recibo
-- (M2S1-093). Quién la carga desde «Registrar cobro» es una decisión: hasta
-- hoy, solo el admin (desde /admin/arca). Arranca así; la dueña la cambia en
-- /admin/reglas.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('retencion_en_el_cobro', 'admin', 'Quién carga una retención sufrida dentro de un cobro: admin o quien_cobra (M2S1-093)')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'retencion_en_el_cobro';
