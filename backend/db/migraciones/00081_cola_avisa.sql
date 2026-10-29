-- +goose Up
-- Cada trabajo nuevo avisa (pg_notify, que sale al confirmar la transacción)
-- y el worker de Go se despierta en el acto, sin esperar su vuelta de 2 s:
-- un mensaje de WhatsApp entrante aparece en la bandeja enseguida, como
-- cuando lo procesaba el TS en el mismo pedido. Vale para lo que encola el
-- TS y para lo que encola Go.
-- +goose StatementBegin
CREATE FUNCTION avisar_trabajo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('mjbj_cola', NEW.tipo);
  RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER trabajos_avisan AFTER INSERT ON trabajos FOR EACH ROW EXECUTE FUNCTION avisar_trabajo();

-- +goose Down
DROP TRIGGER trabajos_avisan ON trabajos;
DROP FUNCTION avisar_trabajo();
