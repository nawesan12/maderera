-- +goose Up
-- Cuándo cuenta una venta, según la regla «venta_reconocida» (00290, H162):
-- al entregar o facturar, lo primero (el de arranque, el de la 00275), al
-- tomar el pedido, solo al entregar o solo al facturar.
--
-- orders.vendido_at sigue siendo la única fecha que leen los reportes, el
-- inicio, la ganancia y el cierre (con su índice). Ahora sale de tres
-- fechas guardadas: created_at (se tomó), entregado_at (la primera entrega)
-- y facturado_at (la primera factura que no es borrador; dar de baja la
-- factura no la borra). La regla elige cuál.
--
-- **Un mes cerrado no cambia.** Cambiar la regla recalcula vendido_at, pero
-- una venta que ya cayó en un mes cerrado se queda ahí, y una que con la
-- regla nueva caería en un mes cerrado pasa al primer instante del primer
-- mes abierto que le sigue: lo que el estudio ya recibió no se mueve, y lo
-- que falta se reconoce en el primer mes que todavía se puede tocar.
--
-- Y el pedido cancelado después de contar como venta (cancelado_at, la
-- primera vez que pasó a «cancelado») deja de borrarse de su mes: resta en
-- el de la cancelación, como una devolución (reportes.hechosDeVenta).
-- +goose StatementBegin
ALTER TABLE orders ADD COLUMN entregado_at timestamptz, ADD COLUMN facturado_at timestamptz, ADD COLUMN cancelado_at timestamptz;
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE orders o SET
	entregado_at = coalesce((SELECT min(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.estado = 'entregado'),
		CASE WHEN o.estado = 'entregado' THEN o.created_at END),
	facturado_at = (SELECT min(f.fecha_emision) FROM invoices f WHERE f.order_id = o.id AND f.tipo::text LIKE 'factura%' AND f.estado <> 'borrador'),
	cancelado_at = CASE WHEN o.estado = 'cancelado' THEN coalesce(
		(SELECT min(h.created_at) FROM order_status_history h WHERE h.order_id = o.id AND h.estado = 'cancelado'), o.updated_at) END;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TRIGGER orders_venta_entregada ON orders;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TRIGGER invoices_venta_facturada ON invoices;
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION venta_entregada();
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION venta_facturada();
-- +goose StatementEnd

-- La fecha de la venta según la regla, sin mirar los meses cerrados.
-- +goose StatementBegin
CREATE FUNCTION venta_segun_regla(regla text, tomado timestamptz, entregado timestamptz, facturado timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
	SELECT CASE regla
		WHEN 'tomar' THEN tomado
		WHEN 'entregar' THEN entregado
		WHEN 'facturar' THEN facturado
		ELSE least(entregado, facturado) END;
$$;
-- +goose StatementEnd

-- La regla vigente; sin fila o con basura, la de arranque (reglas.Valor).
-- +goose StatementBegin
CREATE FUNCTION regla_de_venta() RETURNS text LANGUAGE sql STABLE AS $$
	SELECT coalesce((SELECT valor FROM site_settings WHERE clave = 'venta_reconocida'
		AND valor IN ('entregar_o_facturar', 'tomar', 'entregar', 'facturar')), 'entregar_o_facturar');
$$;
-- +goose StatementEnd

-- El primer instante abierto desde t: t si su mes (argentino) no está
-- cerrado, o el comienzo del primer mes abierto que le sigue.
-- +goose StatementBegin
CREATE FUNCTION primer_instante_abierto(t timestamptz) RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
BEGIN
	IF t IS NULL THEN RETURN NULL; END IF;
	WHILE EXISTS (SELECT 1 FROM meses_cerrados m WHERE m.mes = mes_de_instante(t)) LOOP
		t := (date_trunc('month', t AT TIME ZONE 'America/Argentina/Buenos_Aires') + interval '1 month')
			AT TIME ZONE 'America/Argentina/Buenos_Aires';
	END LOOP;
	RETURN t;
END $$;
-- +goose StatementEnd

-- La fecha nueva de una venta que tenía `vieja`: la de un mes cerrado no se
-- mueve; la nueva no entra en un mes cerrado.
-- +goose StatementBegin
CREATE FUNCTION venta_sin_tocar_lo_cerrado(vieja timestamptz, nueva timestamptz) RETURNS timestamptz LANGUAGE sql STABLE AS $$
	SELECT CASE
		WHEN vieja IS NOT NULL AND EXISTS (SELECT 1 FROM meses_cerrados m WHERE m.mes = mes_de_instante(vieja)) THEN vieja
		WHEN vieja IS NOT NULL AND nueva IS NOT NULL AND mes_de_instante(vieja) = mes_de_instante(nueva) THEN nueva
		ELSE primer_instante_abierto(nueva) END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION venta_del_pedido() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.estado = 'entregado' AND NEW.entregado_at IS NULL THEN
		NEW.entregado_at := CASE WHEN TG_OP = 'INSERT' THEN NEW.created_at ELSE now() END;
	END IF;
	IF NEW.estado = 'cancelado' AND NEW.cancelado_at IS NULL THEN
		NEW.cancelado_at := CASE WHEN TG_OP = 'INSERT' THEN NEW.created_at ELSE now() END;
	END IF;
	NEW.vendido_at := venta_sin_tocar_lo_cerrado(CASE WHEN TG_OP = 'UPDATE' THEN OLD.vendido_at END,
		venta_segun_regla(regla_de_venta(), NEW.created_at, NEW.entregado_at, NEW.facturado_at));
	RETURN NEW;
END $$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER orders_venta_del_pedido BEFORE INSERT OR UPDATE OF estado, entregado_at, facturado_at, created_at ON orders
	FOR EACH ROW EXECUTE FUNCTION venta_del_pedido();
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION venta_facturada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.order_id IS NOT NULL AND NEW.tipo::text LIKE 'factura%' AND NEW.estado <> 'borrador' THEN
		UPDATE orders SET facturado_at = NEW.fecha_emision
		WHERE id = NEW.order_id AND (facturado_at IS NULL OR facturado_at > NEW.fecha_emision);
	END IF;
	RETURN NULL;
END $$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER invoices_venta_facturada AFTER INSERT OR UPDATE OF estado, fecha_emision, order_id ON invoices
	FOR EACH ROW EXECUTE FUNCTION venta_facturada();
-- +goose StatementEnd

-- Cambiar la regla recalcula todas las ventas, sin tocar lo cerrado.
-- +goose StatementBegin
CREATE FUNCTION venta_regla_cambiada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	UPDATE orders SET vendido_at = venta_sin_tocar_lo_cerrado(vendido_at,
		venta_segun_regla(regla_de_venta(), created_at, entregado_at, facturado_at))
	WHERE vendido_at IS DISTINCT FROM venta_sin_tocar_lo_cerrado(vendido_at,
		venta_segun_regla(regla_de_venta(), created_at, entregado_at, facturado_at));
	RETURN NULL;
END $$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER site_settings_venta_reconocida AFTER INSERT OR UPDATE OF valor ON site_settings
	FOR EACH ROW WHEN (NEW.clave = 'venta_reconocida') EXECUTE FUNCTION venta_regla_cambiada();
-- +goose StatementEnd

-- Lo vendido según la regla de hoy (la de arranque, salvo que alguien la
-- haya cambiado antes de migrar), sin tocar lo cerrado.
-- +goose StatementBegin
UPDATE orders SET vendido_at = venta_sin_tocar_lo_cerrado(vendido_at, venta_segun_regla(regla_de_venta(), created_at, entregado_at, facturado_at))
WHERE vendido_at IS DISTINCT FROM venta_sin_tocar_lo_cerrado(vendido_at, venta_segun_regla(regla_de_venta(), created_at, entregado_at, facturado_at));
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX orders_cancelado_idx ON orders (cancelado_at) WHERE cancelado_at IS NOT NULL AND vendido_at IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TRIGGER site_settings_venta_reconocida ON site_settings;
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION venta_regla_cambiada();
-- +goose StatementEnd
-- +goose StatementBegin
DROP TRIGGER invoices_venta_facturada ON invoices;
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION venta_facturada();
-- +goose StatementEnd
-- +goose StatementBegin
DROP TRIGGER orders_venta_del_pedido ON orders;
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION venta_del_pedido();
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION venta_sin_tocar_lo_cerrado(timestamptz, timestamptz);
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION primer_instante_abierto(timestamptz);
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION regla_de_venta();
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION venta_segun_regla(text, timestamptz, timestamptz, timestamptz);
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
-- +goose StatementBegin
DROP INDEX orders_cancelado_idx;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE orders DROP COLUMN entregado_at, DROP COLUMN facturado_at, DROP COLUMN cancelado_at;
-- +goose StatementEnd
