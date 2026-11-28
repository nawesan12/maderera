-- +goose Up
-- Cobranzas y Pedidos al instante (M3S3-045): acreditar o rechazar en una
-- pestaña dejaba «A verificar 5» en la otra, y un pedido cancelado seguía en
-- la lista; /api/vivo solo mandaba los del taller. Por sentencia, como los
-- precios: quien escucha solo necesita saber que algo cambió.
-- +goose StatementBegin
CREATE TRIGGER mjbj_vivo_cobros AFTER INSERT OR UPDATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION mjbj_vivo_sentencia('cobros');
-- +goose StatementEnd
-- Los cambios de estado de un pedido ya avisan: «ventas» (00363, por
-- sentencia) y «pedidos» (00381, por fila). Esta migración traía su propio
-- canal con el mismo nombre de trigger que la 00363; al integrar las ramas
-- del mes simulado quedó solo el de los cobros.

-- +goose Down
DROP TRIGGER mjbj_vivo_cobros ON payments;
