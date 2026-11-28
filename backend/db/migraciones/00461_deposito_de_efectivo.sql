-- +goose Up
-- De qué Caja sale, en los asientos, el efectivo que va al banco (recorrido
-- M4-095: la Caja del archivo del estudio quedaba en negativo porque el
-- efectivo depositado era de ventas del circuito B). Arranca en «estudio»,
-- que es como funciona; «lo_que_hay» la saca de esa Caja hasta lo que tiene
-- y el resto, de la del B contra Movimientos a imputar.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('deposito_de_efectivo', 'estudio', 'De qué Caja sale el efectivo que va al banco en los asientos: estudio o lo_que_hay')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'deposito_de_efectivo';
