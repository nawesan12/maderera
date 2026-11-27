-- +goose Up
-- Mes simulado 2 (M2S4-012): el canal «pedidos» solo avisaba los pedidos
-- de la tienda, que está apagada: un pedido creado desde un presupuesto, o
-- cancelado, no aparecía ni desaparecía en otra pantalla abierta hasta
-- recargar. Ahora avisa todo pedido nuevo y todo cambio de estado, con el
-- origen y si es nuevo: la pantalla refresca siempre y el aviso «Entró un
-- pedido web» sale solo con los de la tienda.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION mjbj_vivo_fila() RETURNS trigger AS $$
DECLARE
  carga jsonb;
BEGIN
  carga := jsonb_build_object('canal', TG_ARGV[0], 'id', NEW.id);
  IF TG_TABLE_NAME = 'cutting_orders' THEN
    carga := carga || jsonb_build_object('numero', NEW.numero, 'estado', NEW.estado);
  ELSIF TG_TABLE_NAME = 'orders' THEN
    carga := carga || jsonb_build_object('numero', NEW.numero, 'estado', NEW.estado, 'origen', NEW.origen,
      'nuevo', TG_OP = 'INSERT');
  ELSIF TG_TABLE_NAME = 'whatsapp_mensajes' THEN
    carga := jsonb_build_object('canal', TG_ARGV[0], 'id', NEW.conversacion_id);
  END IF;
  PERFORM pg_notify('mjbj_vivo', carga::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
DROP TRIGGER IF EXISTS mjbj_vivo_pedidos ON orders;
-- +goose StatementBegin
CREATE TRIGGER mjbj_vivo_pedidos AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION mjbj_vivo_fila('pedidos');
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER mjbj_vivo_pedidos_estado AFTER UPDATE OF estado ON orders
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION mjbj_vivo_fila('pedidos');
-- +goose StatementEnd

-- +goose Down
DROP TRIGGER IF EXISTS mjbj_vivo_pedidos_estado ON orders;
DROP TRIGGER IF EXISTS mjbj_vivo_pedidos ON orders;
-- +goose StatementBegin
CREATE TRIGGER mjbj_vivo_pedidos AFTER INSERT ON orders
  FOR EACH ROW WHEN (NEW.origen = 'tienda') EXECUTE FUNCTION mjbj_vivo_fila('pedidos');
-- +goose StatementEnd
-- +goose StatementBegin
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
-- +goose StatementEnd
