-- +goose Up
-- El gasto del mes (cada vez que se abre la bandeja y antes de cada envío)
-- recorría todos los mensajes de la historia: con 40.000, 6 + 16 ms, y
-- crece sin techo. Solo cuentan los salientes por la API del mes en curso.
CREATE INDEX whatsapp_mensajes_gasto_idx ON whatsapp_mensajes (created_at)
  INCLUDE (cobro_categoria, cobrable, plantilla, estado, wa_message_id, origen)
  WHERE direccion = 'saliente' AND importado = false;

-- +goose Down
DROP INDEX whatsapp_mensajes_gasto_idx;
