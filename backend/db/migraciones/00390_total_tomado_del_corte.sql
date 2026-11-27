-- +goose Up
-- Lo que se le dijo al cliente al tomar el corte (mes simulado, M3S2-030): si
-- después cambia la tarifa o el precio de la placa, la ficha muestra el
-- total de antes al lado del de hoy, y no cambia sola sin que nadie lo vea.
ALTER TABLE cutting_orders ADD COLUMN total_tomado numeric(14, 2);

-- +goose Down
ALTER TABLE cutting_orders DROP COLUMN total_tomado;
