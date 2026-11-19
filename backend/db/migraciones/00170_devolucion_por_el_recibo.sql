-- +goose Up
-- La devolución parcial de un pedido que se cobró con recibo, o que no se
-- cobró (comité final, A3).
--
-- Los topes de la devolución salían de order_payments, que solo tiene la
-- venta del mostrador. Un pedido de presupuesto se cobra con recibo, y sin
-- order_payments se tomaba el total como cobrado por el medio del pedido:
-- salía efectivo de la caja por plata que nunca entró (el pedido sin
-- cobrar) o que entró por el banco. Y como la plata no salía de ningún
-- cobro anotado, la caja tenía la salida y el CSV del estudio no tenía el
-- asiento.
--
-- 1. receipt_refunds: lo que una devolución le devolvió a un recibo, por
--    medio. El cierre lo asienta como reintegro con el reparto del recibo
--    (el blanco y el B en la misma proporción en que se cobró), igual que
--    los tramos de Mercado Pago (payment_refunds).
CREATE TABLE receipt_refunds (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	receipt_id uuid NOT NULL REFERENCES receipts(id),
	devolucion_id uuid NOT NULL REFERENCES devoluciones(id),
	medio medio_de_cobro NOT NULL,
	importe numeric(12, 2) NOT NULL CHECK (importe > 0),
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receipt_refunds_recibo_idx ON receipt_refunds (receipt_id);
CREATE INDEX receipt_refunds_fecha_idx ON receipt_refunds (created_at);

-- 2. «deuda»: lo devuelto de lo que no se cobró. No sale plata: baja lo que
--    el cliente debe del pedido (fragmentos.SinCobrarDelPedido lo resta).
ALTER TABLE devoluciones DROP CONSTRAINT devoluciones_destino_check;
ALTER TABLE devoluciones ADD CONSTRAINT devoluciones_destino_check CHECK (destino IN ('caja', 'cuenta', 'afuera', 'deuda'));

-- +goose Down
ALTER TABLE devoluciones DROP CONSTRAINT devoluciones_destino_check;
ALTER TABLE devoluciones ADD CONSTRAINT devoluciones_destino_check CHECK (destino IN ('caja', 'cuenta', 'afuera'));
DROP TABLE receipt_refunds;
