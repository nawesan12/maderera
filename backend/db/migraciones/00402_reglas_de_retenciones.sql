-- +goose Up
-- Dos políticas de las retenciones que esperan al estudio (mes simulado
-- 23). Arrancan como funcionaba el sistema: solo el CSV y la alícuota de IVA
-- sobre el neto.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('exportar_sicore', 'no', 'Las retenciones del mes también en TXT de SICORE: no o si (M2S1-145)'),
  ('base_retencion_iva', 'neto', 'La retención de IVA se calcula sobre: neto o total (M3S2-027)')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave IN ('exportar_sicore', 'base_retencion_iva');
