-- +goose Up
-- De qué devolución sale cada tramo de un cobro (payment_refunds). La
-- devolución «por afuera» de una venta del mostrador cobrada con tarjeta,
-- transferencia o cheque no anotaba nada: la nota de crédito acreditaba
-- Deudores y el CSV del estudio no tenía el reintegro (Deudores contra
-- Banco). Ahora la devolución anota el tramo en el cobro, como ya lo hacía
-- la de caja, y esta columna lo distingue del aviso de Mercado Pago: el
-- cierre devuelve por el banco el tramo de un cheque que dejó una
-- devolución (el cheque sigue en cartera) y la anulación de la venta no
-- devuelve dos veces lo que ya salió por afuera.
--
-- Sin ON DELETE: una devolución con tramos no se borra (RESTRICT, el
-- default), porque el tramo ya está en el CSV de un mes. Los tramos de caja
-- de antes quedan en NULL: solo la anulación con cheque mira la columna, y
-- la caja nunca toca un cheque.
-- +goose StatementBegin
ALTER TABLE payment_refunds ADD COLUMN devolucion_id uuid REFERENCES devoluciones (id);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX payment_refunds_devolucion_idx ON payment_refunds (devolucion_id) WHERE devolucion_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX payment_refunds_devolucion_idx;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE payment_refunds DROP COLUMN devolucion_id;
-- +goose StatementEnd
