-- +goose Up
-- El bot de WhatsApp arma presupuestos (10/11/2026): quedan «en revisión»
-- con origen «whatsapp», y una persona los revisa y los manda.
--   bot_pendiente: el presupuesto a medio pedir mientras el bot pregunta la
--     medida («¿en qué medida?» → «de 18»): producto, cantidad y el texto.
ALTER TYPE origen_presupuesto ADD VALUE IF NOT EXISTS 'whatsapp';
ALTER TABLE whatsapp_conversaciones ADD COLUMN bot_pendiente jsonb;

-- +goose Down
-- Postgres no saca valores de un enum; el valor queda sin uso.
ALTER TABLE whatsapp_conversaciones DROP COLUMN bot_pendiente;
