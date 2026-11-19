-- +goose Up
-- Contabilidad fina (tanda T6 de la revisión del comité, 18/11/2026).

-- 1. De qué renglón del pedido salió cada renglón de la factura. La
-- devolución parcial lo necesita para saber qué variante vuelve al stock;
-- sin él (las facturas de antes, el envío, un corte) devuelve la plata y no
-- toca el stock. No se adivina por descripción: dos renglones iguales con
-- variantes distintas devolverían la que no era.
ALTER TABLE invoice_items ADD COLUMN order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL;
CREATE INDEX invoice_items_order_item_idx ON invoice_items (order_item_id) WHERE order_item_id IS NOT NULL;

-- 2. La devolución parcial de una venta: la nota de crédito, lo que volvió
-- al stock (inventory_movements con documento_tipo 'devolucion' y este id) y
-- la plata, por la caja de la sucursal adonde entró la mercadería o por la
-- cuenta corriente. La clave la genera el navegador por intento: el doble
-- clic o el reintento de una respuesta perdida no devuelve dos veces.
CREATE TABLE devoluciones (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	clave text NOT NULL,
	order_id uuid NOT NULL REFERENCES orders(id),
	invoice_id uuid NOT NULL REFERENCES invoices(id),
	nota_id uuid NOT NULL REFERENCES invoices(id),
	importe numeric(12, 2) NOT NULL CHECK (importe > 0),
	destino text NOT NULL CHECK (destino IN ('caja', 'cuenta')),
	branch_id uuid REFERENCES branches(id),
	-- Por qué no vuelve al stock algo de lo que se devuelve: la placa rota
	-- es justo la excusa del que se lleva plata sin devolver nada, así que
	-- es de una lista y no texto libre.
	sin_stock text CHECK (sin_stock IN ('rota', 'otro')),
	motivo text NOT NULL,
	cash_movement_id uuid REFERENCES cash_movements(id),
	account_movement_id uuid REFERENCES account_movements(id),
	created_by_user_id text REFERENCES "user"(id),
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX devoluciones_clave_idx ON devoluciones (clave);
CREATE INDEX devoluciones_pedido_idx ON devoluciones (order_id);
CREATE INDEX devoluciones_fecha_idx ON devoluciones (created_at);

-- 3. La condición del proveedor frente a Ganancias. Nula es «no se sabe»:
-- al RI sin condición no se le retiene hasta cargarla (ante la duda la ley
-- aplica la tabla de no inscripto, y la diferencia la paga el agente). La
-- exención vale hasta la fecha del certificado de exclusión.
ALTER TABLE suppliers
	ADD COLUMN condicion_ganancias text CHECK (condicion_ganancias IN ('inscripto', 'no_inscripto', 'exento')),
	ADD COLUMN exento_ganancias_hasta date;

-- 4. Cada cambio de estado de un cheque, con su fecha: el asiento de cada
-- uno (depositado, acreditado, rechazado) sale de acá. Un trigger y no cada
-- UPDATE a mano: el próximo que cambie un estado no se lo puede olvidar. El
-- usuario lo deja la transacción con set_config('mjbj.usuario', …, true).
CREATE TABLE cheque_estados (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	cheque_id uuid NOT NULL REFERENCES cheques(id) ON DELETE CASCADE,
	desde estado_cheque NOT NULL,
	hacia estado_cheque NOT NULL,
	at timestamptz NOT NULL DEFAULT now(),
	created_by_user_id text
);
CREATE INDEX cheque_estados_cheque_idx ON cheque_estados (cheque_id);
CREATE INDEX cheque_estados_at_idx ON cheque_estados (at);

-- +goose StatementBegin
CREATE FUNCTION anotar_estado_de_cheque() RETURNS trigger AS $$
BEGIN
	INSERT INTO cheque_estados (cheque_id, desde, hacia, created_by_user_id)
	VALUES (NEW.id, OLD.estado, NEW.estado, nullif(current_setting('mjbj.usuario', true), ''));
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER cheques_estado_anotado AFTER UPDATE OF estado ON cheques
	FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado) EXECUTE FUNCTION anotar_estado_de_cheque();

-- 5. El padrón de ARBA, solo con los CUIT de nuestros clientes: la alícuota
-- de percepción de cada uno y su vigencia (el padrón es mensual). Sin fila
-- vigente no se percibe.
CREATE TABLE padron_iibb (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	cuit text NOT NULL,
	alicuota numeric(6, 3) NOT NULL CHECK (alicuota >= 0 AND alicuota <= 100),
	vigencia_desde date NOT NULL,
	vigencia_hasta date NOT NULL CHECK (vigencia_hasta >= vigencia_desde),
	cargado_por text REFERENCES "user"(id),
	cargado_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (cuit, vigencia_desde)
);
CREATE INDEX padron_iibb_vigencia_idx ON padron_iibb (vigencia_hasta);

-- La alícuota única deja de usarse: con la percepción encendida, desde hoy
-- se percibiría por padrón y el padrón está vacío, así que nadie se
-- enteraría de que se dejó de percibir. Se apaga y el cierre lo muestra.
UPDATE configuracion_fiscal SET percibe_iibb = false WHERE percibe_iibb;

-- 6. De qué ambiente de ARCA salió el CAE. Un CAE de homologación no vale
-- ante el fisco: no va al libro IVA ni al cierre, y el PDF lo dice. ARCA de
-- producción nunca se encendió (30/10), así que todo CAE de antes es de
-- prueba.
ALTER TABLE invoices ADD COLUMN cae_ambiente text CHECK (cae_ambiente IN ('homologacion', 'produccion'));
UPDATE invoices SET cae_ambiente = 'homologacion' WHERE cae IS NOT NULL;

-- +goose Down
ALTER TABLE invoices DROP COLUMN cae_ambiente;
DROP TABLE padron_iibb;
DROP TRIGGER cheques_estado_anotado ON cheques;
DROP FUNCTION anotar_estado_de_cheque();
DROP TABLE cheque_estados;
ALTER TABLE suppliers DROP COLUMN condicion_ganancias, DROP COLUMN exento_ganancias_hasta;
DROP TABLE devoluciones;
ALTER TABLE invoice_items DROP COLUMN order_item_id;
