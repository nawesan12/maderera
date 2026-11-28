-- +goose Up
-- Qué retenciones arrancan tildadas al pagarle a un proveedor (recorrido
-- M4-004: con el régimen de Ganancias en uso, el pago salía sin retener si
-- nadie tocaba el interruptor). Arranca en «con_base», que es como funciona:
-- solo las que ya tuvieron base en el mes; «las_que_corresponden» también
-- tilda la única de cada impuesto que le corresponde y retiene algo.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('retenciones_al_pagar', 'con_base', 'Qué retenciones arrancan tildadas al pagar: con_base o las_que_corresponden')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'retenciones_al_pagar';
