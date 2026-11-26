-- +goose Up
-- El recibo cuyo excedente sin destino fue a Anticipos de clientes y no al
-- circuito B, por las reglas «cobro_antes_de_facturar» (H374) y
-- «excedente_cuenta_corriente» (H407) en «anticipos». Se fija al emitir,
-- como el reparto: cambiar la regla después no mueve lo ya repartido. Con
-- la marca, el anticipo se le aplica a la factura de su pedido (o, sin
-- pedido, a la próxima factura del cliente) aunque el día del recibo no
-- hubiera nada pendiente.
ALTER TABLE receipts ADD COLUMN anticipo_por_regla boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE receipts DROP COLUMN anticipo_por_regla;
