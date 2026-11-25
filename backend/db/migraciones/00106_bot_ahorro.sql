-- +goose Up
-- El bot de WhatsApp ahorra mensajes (18/11/2026, Nahuel: «así no nos pasamos
-- de los 1000 por mes»). Meta cobra cada saliente desde el 1/10/2026.
--   whatsapp_tope_mensajes: cuántos mensajes pueden salir por la API en el
--     mes, entre el bot y las personas. Al 80 % el bot pasa a modo ahorro; al
--     100 % no sale nada automático.
--   bot_cerrado_hasta: hasta cuándo ya se le dijo a esa conversación que
--     estamos cerrados (la próxima apertura): el aviso sale una vez.
--   mensajes_aviso80/100: el mes en que ya se avisó al admin cada umbral de
--     la cantidad de mensajes, como tope_aviso80/100 con los dólares.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
	('whatsapp_tope_mensajes', '1000', 'Mensajes por WhatsApp en el mes, entre el bot y las personas')
ON CONFLICT (clave) DO NOTHING;
ALTER TABLE whatsapp_conversaciones ADD COLUMN bot_cerrado_hasta timestamptz;
ALTER TABLE whatsapp_sesion
	ADD COLUMN mensajes_aviso80 text,
	ADD COLUMN mensajes_aviso100 text;

-- +goose Down
ALTER TABLE whatsapp_sesion
	DROP COLUMN mensajes_aviso80,
	DROP COLUMN mensajes_aviso100;
ALTER TABLE whatsapp_conversaciones DROP COLUMN bot_cerrado_hasta;
DELETE FROM site_settings WHERE clave = 'whatsapp_tope_mensajes';
