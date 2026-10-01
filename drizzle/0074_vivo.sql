-- Lo que pasa en la base, avisado al instante a quien está mirando.
--
-- Cada trigger manda un `pg_notify` por el canal `mjbj_vivo` con un JSON
-- chico: qué cambió y el id. La aplicación tiene una sola conexión escuchando
-- (lib/vivo/escucha.ts) y lo reparte por SSE a las pantallas abiertas.
--
-- Triggers y no llamadas en el código: un corte nace desde el mostrador, el
-- carrito, el panel o la migración de datos, y un mensaje de WhatsApp entra
-- por el webhook o sale desde la bandeja. Con el aviso en la tabla, ningún
-- camino nuevo se olvida de avisar. El `pg_notify` sale recién cuando la
-- transacción confirma: nadie se entera de algo que después se deshizo.
CREATE OR REPLACE FUNCTION mjbj_vivo_fila() RETURNS trigger AS $$
DECLARE
  carga jsonb;
BEGIN
  carga := jsonb_build_object('canal', TG_ARGV[0], 'id', NEW.id);
  IF TG_TABLE_NAME = 'cutting_orders' THEN
    carga := carga || jsonb_build_object('numero', NEW.numero, 'estado', NEW.estado);
  ELSIF TG_TABLE_NAME = 'orders' THEN
    carga := carga || jsonb_build_object('numero', NEW.numero);
  ELSIF TG_TABLE_NAME = 'whatsapp_mensajes' THEN
    carga := jsonb_build_object('canal', TG_ARGV[0], 'id', NEW.conversacion_id);
  END IF;
  PERFORM pg_notify('mjbj_vivo', carga::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Por sentencia y no por fila: un ajuste masivo de precios toca miles de
-- filas, y quien escucha solo necesita saber que «cambiaron los precios».
CREATE OR REPLACE FUNCTION mjbj_vivo_sentencia() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('mjbj_vivo', jsonb_build_object('canal', TG_ARGV[0])::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER mjbj_vivo_cortes AFTER INSERT OR UPDATE ON cutting_orders
  FOR EACH ROW EXECUTE FUNCTION mjbj_vivo_fila('taller');
--> statement-breakpoint
-- Solo los pedidos de la tienda: los del mostrador los cargó alguien que ya
-- sabe que existen.
CREATE TRIGGER mjbj_vivo_pedidos AFTER INSERT ON orders
  FOR EACH ROW WHEN (NEW.origen = 'tienda') EXECUTE FUNCTION mjbj_vivo_fila('pedidos');
--> statement-breakpoint
CREATE TRIGGER mjbj_vivo_mensajes AFTER INSERT OR UPDATE ON whatsapp_mensajes
  FOR EACH ROW EXECUTE FUNCTION mjbj_vivo_fila('whatsapp');
--> statement-breakpoint
CREATE TRIGGER mjbj_vivo_conversaciones AFTER UPDATE ON whatsapp_conversaciones
  FOR EACH ROW EXECUTE FUNCTION mjbj_vivo_fila('whatsapp');
--> statement-breakpoint
CREATE TRIGGER mjbj_vivo_precios AFTER INSERT OR UPDATE OR DELETE ON price_list_items
  FOR EACH STATEMENT EXECUTE FUNCTION mjbj_vivo_sentencia('precios');
