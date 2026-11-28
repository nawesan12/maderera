-- +goose Up
-- El envío que se pasó a pedido con «Sin cargo» a propósito: sin esto, un
-- flete en cero a una zona a cotizar seguía marcado «Flete sin cotizar»
-- (mes 23, depósito).
ALTER TABLE orders ADD COLUMN flete_sin_cargo boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE orders DROP COLUMN flete_sin_cargo;
