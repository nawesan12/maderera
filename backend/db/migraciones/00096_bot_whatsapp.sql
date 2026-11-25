-- +goose Up
-- El bot de WhatsApp (10/11/2026): contesta solo lo que se resuelve con datos
-- y deriva a una persona, en otro número, lo que no.
--   bot_estado: «activo» contesta; «derivada» ya se pasó a una persona y el
--     bot se calla hasta que alguien lo reactive desde la bandeja.
--   bot_fallos: cuántas veces seguidas no entendió. A la segunda, deriva.
--   bot_consulta: lo último que se buscó, para «¿y en 18?».
-- Los dos ajustes nacen apagado y vacío: cada respuesta del bot la cobra Meta.
-- +goose StatementBegin
ALTER TABLE whatsapp_conversaciones
	ADD COLUMN bot_estado text NOT NULL DEFAULT 'activo' CHECK (bot_estado IN ('activo', 'derivada')),
	ADD COLUMN bot_fallos integer NOT NULL DEFAULT 0,
	ADD COLUMN bot_consulta text,
	ADD COLUMN bot_derivada_at timestamptz;
-- +goose StatementEnd
INSERT INTO site_settings (clave, valor, descripcion) VALUES
	('whatsapp_bot', 'no', 'Respuestas automáticas por WhatsApp'),
	('whatsapp_numero_humano', '', 'Número de WhatsApp al que el bot deriva a una persona')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave IN ('whatsapp_bot', 'whatsapp_numero_humano');
ALTER TABLE whatsapp_conversaciones
	DROP COLUMN bot_estado,
	DROP COLUMN bot_fallos,
	DROP COLUMN bot_consulta,
	DROP COLUMN bot_derivada_at;
