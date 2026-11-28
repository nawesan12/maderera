-- +goose Up
-- Si la factura de compra que da crédito fiscal (A, M y sus notas) se carga
-- sin CAE (mes simulado, M2S2-039): el gasto con factura A entraba al libro
-- IVA compras como crédito computable sin CAE. Es una decisión del contador:
-- arranca como hasta hoy («opcional») y se cambia desde /admin/reglas. El
-- CAE repetido en otro comprobante se rechaza siempre (no es una política:
-- ARCA no da dos veces el mismo).
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('cae_en_compras', 'opcional', 'La factura de compra que da crédito fiscal sin CAE: opcional o exigido (M2S2-039)')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'cae_en_compras';
