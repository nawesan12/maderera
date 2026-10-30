-- +goose Up
-- La fila del historial lleva la hora en que pasó el cambio, no la de inicio
-- de la transacción (now()): una transacción que esperó el candado del pedido
-- quedaba fechada antes que la que de verdad pasó primero, y el historial
-- mostraba «entregado» antes que «listo».
ALTER TABLE order_status_history ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- +goose Down
ALTER TABLE order_status_history ALTER COLUMN created_at SET DEFAULT now();
