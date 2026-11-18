-- +goose Up
-- Cómo se reparte cada recibo entre los dos circuitos (revisión del
-- comité, 18/11/2026). El CSV para el estudio asentaba todo recibo contra
-- Deudores por el total, y lo que pagaba una venta sin factura dejaba
-- Deudores en negativo: un Deudores que nunca se debitó.
--
-- El reparto se fija cuando se emite el recibo (cobros.FijarReparto) y no se
-- vuelve a calcular: una baja, un CAE que llega tarde o una nota de crédito
-- de noviembre no pueden cambiar lo que octubre ya le mandó al estudio. La
-- anulación usa el mismo reparto, al revés.
--
--   - reparto_deudores: lo que cancela facturas con CAE (blanco, Deudores);
--   - reparto_anticipo: lo que entra antes de la factura, con algo pendiente
--     de facturar o de CAE (blanco, Anticipos de clientes; se aplica a
--     Deudores cuando sale la factura);
--   - reparto_b: lo que paga ventas sin factura (circuito B, su propio CSV).
--
-- Nulos en los recibos de antes: se calculan con los hechos hasta su fecha
-- la primera vez que se exporta un cierre, y desde ahí quedan fijos.
ALTER TABLE receipts
	ADD COLUMN reparto_deudores numeric(12, 2),
	ADD COLUMN reparto_anticipo numeric(12, 2),
	ADD COLUMN reparto_b numeric(12, 2);

-- +goose Down
ALTER TABLE receipts DROP COLUMN reparto_deudores, DROP COLUMN reparto_anticipo, DROP COLUMN reparto_b;
