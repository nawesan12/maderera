-- +goose Up
-- Un pedido con una parte a cuenta corriente y el resto por otro medio (mes
-- simulado, H047): el cliente con $800.000 disponibles y un pedido de
-- $1.325.775 tenía que pasarlo entero a transferencia. a_cuenta es lo que se
-- cargó a la cuenta (el movimiento «compra» con el número del pedido); el
-- resto se cobra como un pedido de contado, con medio_pago. NULL en los de
-- siempre: todo a cuenta (medio cuenta_corriente) o nada.
ALTER TABLE orders ADD COLUMN a_cuenta numeric(12, 2) CHECK (a_cuenta > 0);

-- +goose Down
ALTER TABLE orders DROP COLUMN a_cuenta;
