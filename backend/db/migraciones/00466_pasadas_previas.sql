-- +goose Up
-- Recorrido M4-089: las pasadas que tenía el corte antes de que el taller
-- las corrigiera al marcarlo terminado. «Deshacer» devolvía el corte a la
-- máquina pero dejaba las corregidas, y el cobro quedaba más bajo.
ALTER TABLE cutting_orders ADD COLUMN pasadas_previas integer;

-- +goose Down
ALTER TABLE cutting_orders DROP COLUMN pasadas_previas;
