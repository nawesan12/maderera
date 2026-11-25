-- +goose Up
-- La salida de una serie trabada (revisión del comité, 18/11/2026).
--
-- Un comprobante que ARCA no autorizó traba a todos los que vienen detrás en
-- su punto de venta y tipo: ARCA no deja saltear números. La baja lo saca de
-- la serie y corre los pendientes un número para abajo. La fila se borra
-- —hay decenas de lecturas de `invoices` que esperan un número— y lo que era
-- queda acá entero: cabecera, renglones, tributos, cobros, los movimientos de
-- cuenta que cargó y lo que contestó ARCA (arca_log pierde el invoice_id al
-- borrar, y es el único rastro de por qué lo rechazó).
--
-- `renumerados` dice a quién hay que reenviarle el comprobante: el que tenía
-- el PDF del 0005 ahora tiene el 0004.
CREATE TABLE invoices_dadas_de_baja (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	invoice_id uuid NOT NULL,
	tipo tipo_comprobante NOT NULL,
	punto_venta integer NOT NULL,
	numero integer NOT NULL,
	receptor_nombre text NOT NULL,
	customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
	order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
	total numeric(12, 2) NOT NULL,
	fecha_emision timestamp with time zone NOT NULL,
	motivo text NOT NULL,
	usuario_id text REFERENCES "user"(id) ON DELETE SET NULL,
	usuario_nombre text NOT NULL,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	renumerados jsonb NOT NULL DEFAULT '[]'::jsonb,
	comprobante jsonb NOT NULL
);
CREATE INDEX invoices_dadas_de_baja_created_idx ON invoices_dadas_de_baja (created_at);

-- Al reintentar, el comprobante sale con la fecha del día (ARCA acepta unos
-- pocos días para atrás). La fecha con que se emitió queda acá: si era de un
-- mes que ya se cerró, la venta pasa al mes del reintento y el contador lo
-- tiene que ver.
ALTER TABLE invoices ADD COLUMN fecha_emision_original timestamp with time zone;

-- +goose Down
ALTER TABLE invoices DROP COLUMN fecha_emision_original;
DROP TABLE invoices_dadas_de_baja;
