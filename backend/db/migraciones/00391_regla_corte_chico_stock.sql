-- +goose Up
-- Qué pasa con el stock de la placa de la casa de un corte que no pasa la
-- media placa (mes simulado, M3S4-016): no_mueve (como hasta hoy: el recorte
-- queda en la maderera y la placa sigue contada) o descuenta (al terminar el
-- corte sale del stock, y vuelve si el taller lo devuelve a la máquina).
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('corte_chico_stock', 'no_mueve', 'El stock de la placa de la casa de un corte chico: no_mueve o descuenta (M3S4-016)')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'corte_chico_stock';
