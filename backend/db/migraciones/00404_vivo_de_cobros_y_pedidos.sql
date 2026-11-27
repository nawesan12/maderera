-- +goose Up
-- Cobranzas y Pedidos al instante (M3S3-045): acreditar o rechazar en una
-- pestaña dejaba «A verificar 5» en la otra, y un pedido cancelado seguía en
-- la lista; /api/vivo solo mandaba los del taller. Por sentencia, como los
-- precios: quien escucha solo necesita saber que algo cambió.
-- +goose StatementBegin
CREATE TRIGGER mjbj_vivo_cobros AFTER INSERT OR UPDATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION mjbj_vivo_sentencia('cobros');
-- +goose StatementEnd
-- +goose StatementBegin
-- Los cambios de estado de un pedido, en su propio canal: «pedidos» avisa
-- de un pedido nuevo de la tienda, con su número.
CREATE TRIGGER mjbj_vivo_estado_pedidos AFTER UPDATE OF estado ON orders
  FOR EACH STATEMENT EXECUTE FUNCTION mjbj_vivo_sentencia('estado_pedidos');
-- +goose StatementEnd

-- +goose Down
DROP TRIGGER mjbj_vivo_estado_pedidos ON orders;
DROP TRIGGER mjbj_vivo_cobros ON payments;
