-- +goose Up
-- El circuito que el reparto del recibo le dio a cada cheque (mes simulado,
-- M3S3-001): «negro» si el recibo lo mandó entero al B, «blanco» si entero al
-- archivo del estudio, «partido» si se reparte. Su depósito, su endoso y su
-- rechazo van al mismo archivo por el que entró. `circuito` sigue siendo lo
-- que se marcó al cobrarlo.
ALTER TABLE cheques ADD COLUMN circuito_reparto text
	CHECK (circuito_reparto IN ('blanco', 'negro', 'partido'));

-- +goose Down
ALTER TABLE cheques DROP COLUMN circuito_reparto;
