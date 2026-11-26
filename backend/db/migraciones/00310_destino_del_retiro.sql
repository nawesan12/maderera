-- +goose Up
-- A dónde va un retiro de caja (mes simulado, H333): al banco, a la caja
-- fuerte u otro. «Plata hoy» y el asiento del depósito lo leían del motivo
-- escrito; ahora se elige al retirar. Los retiros de antes quedan sin
-- destino y se siguen clasificando por el motivo.
ALTER TABLE cash_movements ADD COLUMN destino text
	CHECK (destino IS NULL OR (destino IN ('banco', 'caja_fuerte', 'otro') AND tipo = 'retiro'));

-- +goose Down
ALTER TABLE cash_movements DROP COLUMN destino;
