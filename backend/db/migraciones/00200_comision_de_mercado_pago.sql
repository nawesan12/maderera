-- +goose Up
-- La comisión que Mercado Pago se queda de cada cobro, y lo que acredita.
--
-- Hasta acá el cierre mandaba a Banco el bruto de un pago de Mercado Pago:
-- el extracto mostraba menos de lo que decían los libros, una diferencia
-- por cada cobro, y la comisión (un gasto) no aparecía en ningún lado. Ahora
-- el pago guarda lo que trae la respuesta de GET /v1/payments al
-- acreditarse: el neto acreditado (transaction_details.net_received_amount)
-- y la comisión, que es la diferencia con el importe (o, si MP no manda el
-- neto, la suma de fee_details que paga el vendedor). El cierre asienta
-- Banco por el neto y «Comisiones y gastos bancarios» por la comisión.
--
-- Nulas en todo lo de antes, en la transferencia, el mostrador y el
-- simulador: ahí no hay comisión y el asiento no cambia.
-- +goose StatementBegin
ALTER TABLE payments ADD COLUMN comision numeric(12, 2), ADD COLUMN neto_acreditado numeric(12, 2);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE payments DROP COLUMN neto_acreditado, DROP COLUMN comision;
-- +goose StatementEnd
