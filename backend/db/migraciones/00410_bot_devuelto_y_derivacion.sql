-- +goose Up
-- «Devolver al bot» (M2S3-025): el bot no hablaba si una persona había
-- escrito en las últimas 12 horas, aunque la conversación se le devolviera.
-- Desde que se la devuelven, solo cuenta lo que se escriba después.
ALTER TABLE whatsapp_conversaciones ADD COLUMN bot_devuelto_at timestamptz;

-- La derivación con un enlace corto (M2S2-139, M2S3-022): el wa.me con el
-- texto codificado ocupaba cinco renglones. El bot manda
-- /api/whatsapp/hablar/<token>, que redirige al número humano con todo lo
-- que el cliente escribió en la última hora, no solo el último mensaje.
ALTER TABLE whatsapp_conversaciones ADD COLUMN bot_derivacion_token text;
ALTER TABLE whatsapp_conversaciones ADD COLUMN bot_derivacion_texto text;
CREATE UNIQUE INDEX whatsapp_conversaciones_derivacion_idx ON whatsapp_conversaciones (bot_derivacion_token)
	WHERE bot_derivacion_token IS NOT NULL;

-- La consulta de corte que salió de una conversación (M2S3-024, M3S2-018):
-- «Pasar a corte» trae el cliente y el teléfono de quien la mandó.
ALTER TABLE consultas_corte ADD COLUMN whatsapp_conversacion_id uuid
	REFERENCES whatsapp_conversaciones(id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE consultas_corte DROP COLUMN whatsapp_conversacion_id;
DROP INDEX whatsapp_conversaciones_derivacion_idx;
ALTER TABLE whatsapp_conversaciones DROP COLUMN bot_derivacion_texto;
ALTER TABLE whatsapp_conversaciones DROP COLUMN bot_derivacion_token;
ALTER TABLE whatsapp_conversaciones DROP COLUMN bot_devuelto_at;
