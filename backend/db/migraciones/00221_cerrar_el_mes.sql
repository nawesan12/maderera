-- +goose Up
-- Cerrar el mes (simulación del mes, H408). El «Cierre del mes» no cerraba
-- nada: después de mandarle los archivos al estudio se podían seguir
-- cargando gastos con fecha del mes, anulando recibos o dando de baja
-- facturas, y lo que el estudio tenía dejaba de coincidir.
--
-- Una fila por mes cerrado. El candado va en la base, con triggers, y no en
-- cada pantalla: son muchas las puertas que escriben con fecha (gastos,
-- facturas de compra, recibos, pagos, la baja de una factura), y una que se
-- olvide en Go deja el mes abierto sin que nadie lo note. El error lleva el
-- código MJ001 y el mes; la API lo convierte en un 422 con el mes escrito.
--
-- Qué fecha manda en cada tabla: los gastos y las facturas de compra
-- guardan un día (a las 0 UTC): su mes es el UTC. Los recibos, los pagos y
-- las facturas de venta guardan un instante: su mes es el argentino (los
-- mismos cortes que el cierre, reportes/cierre.go).
CREATE TABLE meses_cerrados (
	mes text PRIMARY KEY CHECK (mes ~ '^\d{4}-\d{2}$'),
	cerrado_at timestamptz NOT NULL DEFAULT now(),
	cerrado_por text REFERENCES "user"(id),
	cerrado_por_nombre text
);

-- +goose StatementBegin
CREATE FUNCTION mes_cerrado_si(mes text) RETURNS void AS $$
BEGIN
	IF mes IS NOT NULL AND EXISTS (SELECT 1 FROM meses_cerrados m WHERE m.mes = mes_cerrado_si.mes) THEN
		RAISE EXCEPTION 'MES_CERRADO %', mes USING ERRCODE = 'MJ001';
	END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION mes_de_dia(t timestamptz) RETURNS text AS $$
	SELECT to_char(t AT TIME ZONE 'UTC', 'YYYY-MM');
$$ LANGUAGE sql IMMUTABLE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION mes_de_instante(t timestamptz) RETURNS text AS $$
	SELECT to_char(t AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM');
$$ LANGUAGE sql IMMUTABLE;
-- +goose StatementEnd

-- Gastos: alta, cambio o borrado con fecha de un mes cerrado (la de antes y
-- la nueva).
-- +goose StatementBegin
CREATE FUNCTION mes_cerrado_gastos() RETURNS trigger AS $$
BEGIN
	IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM mes_cerrado_si(mes_de_dia(OLD.fecha)); END IF;
	IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM mes_cerrado_si(mes_de_dia(NEW.fecha)); END IF;
	RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER mes_cerrado_gastos BEFORE INSERT OR UPDATE OR DELETE ON expenses
	FOR EACH ROW EXECUTE FUNCTION mes_cerrado_gastos();

-- Facturas de compra: alta, borrado, anulación o cambio de importes o fecha.
-- +goose StatementBegin
CREATE FUNCTION mes_cerrado_compras() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		PERFORM mes_cerrado_si(mes_de_dia(NEW.fecha_emision));
	ELSIF TG_OP = 'DELETE' THEN
		PERFORM mes_cerrado_si(mes_de_dia(OLD.fecha_emision));
	ELSIF NEW.fecha_emision IS DISTINCT FROM OLD.fecha_emision OR NEW.anulada_at IS DISTINCT FROM OLD.anulada_at
		OR NEW.total IS DISTINCT FROM OLD.total OR NEW.neto IS DISTINCT FROM OLD.neto THEN
		PERFORM mes_cerrado_si(mes_de_dia(OLD.fecha_emision));
		PERFORM mes_cerrado_si(mes_de_dia(NEW.fecha_emision));
	END IF;
	RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER mes_cerrado_compras BEFORE INSERT OR UPDATE OR DELETE ON purchase_invoices
	FOR EACH ROW EXECUTE FUNCTION mes_cerrado_compras();

-- Recibos: la anulación de uno de un mes cerrado.
-- +goose StatementBegin
CREATE FUNCTION mes_cerrado_recibos() RETURNS trigger AS $$
BEGIN
	IF NEW.estado IS DISTINCT FROM OLD.estado OR NEW.anulado_at IS DISTINCT FROM OLD.anulado_at THEN
		PERFORM mes_cerrado_si(mes_de_instante(OLD.created_at));
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER mes_cerrado_recibos BEFORE UPDATE ON receipts
	FOR EACH ROW EXECUTE FUNCTION mes_cerrado_recibos();

-- Pagos a proveedores: el alta con fecha de un mes cerrado y la anulación de
-- uno de ese mes.
-- +goose StatementBegin
CREATE FUNCTION mes_cerrado_pagos() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		PERFORM mes_cerrado_si(mes_de_instante(NEW.fecha));
	ELSIF NEW.anulado_at IS DISTINCT FROM OLD.anulado_at OR NEW.fecha IS DISTINCT FROM OLD.fecha THEN
		PERFORM mes_cerrado_si(mes_de_instante(OLD.fecha));
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER mes_cerrado_pagos BEFORE INSERT OR UPDATE ON supplier_payments
	FOR EACH ROW EXECUTE FUNCTION mes_cerrado_pagos();

-- Facturas de venta: la baja (se borra la fila) de una de un mes cerrado.
-- +goose StatementBegin
CREATE FUNCTION mes_cerrado_facturas() RETURNS trigger AS $$
BEGIN
	PERFORM mes_cerrado_si(mes_de_instante(OLD.fecha_emision));
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER mes_cerrado_facturas BEFORE DELETE ON invoices
	FOR EACH ROW EXECUTE FUNCTION mes_cerrado_facturas();

-- +goose Down
DROP TRIGGER IF EXISTS mes_cerrado_facturas ON invoices;
DROP TRIGGER IF EXISTS mes_cerrado_pagos ON supplier_payments;
DROP TRIGGER IF EXISTS mes_cerrado_recibos ON receipts;
DROP TRIGGER IF EXISTS mes_cerrado_compras ON purchase_invoices;
DROP TRIGGER IF EXISTS mes_cerrado_gastos ON expenses;
DROP FUNCTION IF EXISTS mes_cerrado_facturas();
DROP FUNCTION IF EXISTS mes_cerrado_pagos();
DROP FUNCTION IF EXISTS mes_cerrado_recibos();
DROP FUNCTION IF EXISTS mes_cerrado_compras();
DROP FUNCTION IF EXISTS mes_cerrado_gastos();
DROP FUNCTION IF EXISTS mes_de_instante(timestamptz);
DROP FUNCTION IF EXISTS mes_de_dia(timestamptz);
DROP FUNCTION IF EXISTS mes_cerrado_si(text);
DROP TABLE IF EXISTS meses_cerrados;
