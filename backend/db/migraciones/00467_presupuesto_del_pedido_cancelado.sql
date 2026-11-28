-- +goose Up
-- Recorrido M4-030: el presupuesto de un pedido que se cancela. Arranca en
-- «queda_aceptado», como funciona (vuelve a «aceptado sin pedido»);
-- «se_rechaza» lo cierra con el motivo de la cancelación.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('presupuesto_del_pedido_cancelado', 'queda_aceptado', 'El presupuesto de un pedido cancelado: queda_aceptado o se_rechaza')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'presupuesto_del_pedido_cancelado';
