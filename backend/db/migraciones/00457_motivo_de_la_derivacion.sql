-- +goose Up
-- Por qué el bot pasó la conversación a una persona («Es un reclamo.»,
-- «Pidió presupuesto de…»). Iba solo en el push: en la bandeja no se veía
-- (mes 23, atención).
ALTER TABLE whatsapp_conversaciones ADD COLUMN bot_motivo text;

-- +goose Down
ALTER TABLE whatsapp_conversaciones DROP COLUMN bot_motivo;
