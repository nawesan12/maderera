-- +goose Up
-- El canal «ventas» del tiempo real (mes simulado, M2S2-099 y M3S1-034):
-- facturar, cobrar con un recibo o cancelar un pedido no avisaba a las otras
-- pantallas, porque el canal «pedidos» solo emite para los pedidos de la
-- tienda (y con la tienda apagada no entra ninguno). Facturación, Cobranzas
-- y Pedidos abiertos en otra pestaña quedaban viejos hasta recargar.
--
-- Por sentencia (mjbj_vivo_sentencia), como los precios: quien escucha solo
-- necesita saber que algo cambió y refresca; el aviso sale al confirmar.
CREATE TRIGGER mjbj_vivo_facturas AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH STATEMENT EXECUTE FUNCTION mjbj_vivo_sentencia('ventas');
CREATE TRIGGER mjbj_vivo_recibos AFTER INSERT OR UPDATE ON receipts
  FOR EACH STATEMENT EXECUTE FUNCTION mjbj_vivo_sentencia('ventas');
CREATE TRIGGER mjbj_vivo_estado_pedidos AFTER UPDATE OF estado, estado_pago ON orders
  FOR EACH STATEMENT EXECUTE FUNCTION mjbj_vivo_sentencia('ventas');

-- +goose Down
DROP TRIGGER mjbj_vivo_facturas ON invoices;
DROP TRIGGER mjbj_vivo_recibos ON receipts;
DROP TRIGGER mjbj_vivo_estado_pedidos ON orders;
