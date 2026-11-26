-- +goose Up
-- Cuándo una venta cuenta como vendida (mes simulado, H162): al entregarse
-- o al facturarse, lo que pase primero (el hecho imponible del IVA, art. 5
-- inc. a), no al confirmarse el pedido. El resultado del mes sumaba pedidos
-- preparándose, sin cobrar ni facturar. Es el criterio prudente mientras el
-- contador no diga otro.
--
-- La fecha queda guardada en el pedido, con índice: los reportes y el
-- inicio la filtran por rango sin recorrer orders. La ponen dos triggers:
-- el paso a «entregado» del pedido y la primera factura (no borrador). Una
-- vez puesta solo puede adelantarse: dar de baja la factura no la borra (el
-- mes que ya la contó no cambia).
-- +goose StatementBegin
ALTER TABLE orders ADD COLUMN vendido_at timestamptz;
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE orders o SET vendido_at = coalesce(least(
	(SELECT min(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.estado = 'entregado'),
	(SELECT min(f.fecha_emision) FROM invoices f WHERE f.order_id = o.id AND f.tipo::text LIKE 'factura%' AND f.estado <> 'borrador')),
	CASE WHEN o.estado = 'entregado' THEN o.created_at END);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX orders_vendido_idx ON orders (vendido_at) WHERE vendido_at IS NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION venta_entregada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.estado = 'entregado' AND NEW.vendido_at IS NULL THEN
		NEW.vendido_at := CASE WHEN TG_OP = 'INSERT' THEN NEW.created_at ELSE now() END;
	END IF;
	RETURN NEW;
END $$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER orders_venta_entregada BEFORE INSERT OR UPDATE OF estado ON orders
	FOR EACH ROW EXECUTE FUNCTION venta_entregada();
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION venta_facturada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.order_id IS NOT NULL AND NEW.tipo::text LIKE 'factura%' AND NEW.estado <> 'borrador' THEN
		UPDATE orders SET vendido_at = NEW.fecha_emision
		WHERE id = NEW.order_id AND (vendido_at IS NULL OR vendido_at > NEW.fecha_emision);
	END IF;
	RETURN NULL;
END $$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER invoices_venta_facturada AFTER INSERT OR UPDATE OF estado, fecha_emision, order_id ON invoices
	FOR EACH ROW EXECUTE FUNCTION venta_facturada();
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TRIGGER invoices_venta_facturada ON invoices;
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION venta_facturada();
-- +goose StatementEnd
-- +goose StatementBegin
DROP TRIGGER orders_venta_entregada ON orders;
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION venta_entregada();
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE orders DROP COLUMN vendido_at;
-- +goose StatementEnd
