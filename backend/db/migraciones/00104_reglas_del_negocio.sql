-- +goose Up
-- Las reglas que decide el dueño y se cambian desde el panel (Reglas del
-- negocio): cómo se calcula la ganancia y qué pasa al anular una factura de
-- compra que ya tiene pagos. Los valores de arranque son los de hasta ahora.
-- Y la fecha en que se comprometió entregar el pedido: «atrasado» salía del
-- presupuesto de origen, y un pedido del mostrador o de la tienda no tenía.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('ganancia_gastos', 'con_iva', 'Los gastos en la ganancia del mes: con_iva o sin_iva'),
  ('ganancia_descuento', 'no', 'Restar de las ventas el descuento del pedido: si o no'),
  ('anular_compra_con_pagos', 'a_cuenta', 'Anular una factura de compra ya pagada: a_cuenta (los pagos quedan a cuenta) o bloquear')
ON CONFLICT (clave) DO NOTHING;
ALTER TABLE orders ADD COLUMN entregar_el date;

-- +goose Down
ALTER TABLE orders DROP COLUMN entregar_el;
DELETE FROM site_settings WHERE clave IN ('ganancia_gastos', 'ganancia_descuento', 'anular_compra_con_pagos');
