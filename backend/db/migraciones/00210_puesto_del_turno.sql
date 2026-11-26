-- +goose Up
-- En qué puesto se abrió cada turno (mes simulado, H356): con dos cajas en
-- Casa Central no se sabía de cuál era cada faltante, y una caja vinculada
-- figuraba «nunca se vinculó» aunque su turno estuviera en la lista. Nulo en
-- los turnos de antes y en los que se abren desde una PC sin caja vinculada.
ALTER TABLE cash_sessions ADD COLUMN pos_device_id uuid REFERENCES pos_devices(id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE cash_sessions DROP COLUMN pos_device_id;
