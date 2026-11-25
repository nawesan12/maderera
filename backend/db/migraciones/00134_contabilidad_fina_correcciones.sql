-- +goose Up
-- Las correcciones de la revisión del comité a la contabilidad fina (T6,
-- 18/11/2026).

-- 1. El renglón del pedido de las facturas de antes de la 00133. Sin él, lo
-- devuelto de una venta vieja no volvía al stock y, si estaba en acopio, el
-- remito lo seguía entregando. Es el mismo emparejamiento de la emisión
-- (facturacion.alicuotasDeLaVenta): misma venta, misma descripción y
-- cantidad, en orden y sin usar un renglón dos veces. Lo ambiguo —dos
-- renglones iguales del pedido con variantes distintas, o uno con producto y
-- otro sin— queda nulo: devolvería la variante que no era.
WITH f AS (
	SELECT ii.id, i.order_id, ii.descripcion, ii.cantidad,
		row_number() OVER (PARTITION BY ii.invoice_id, ii.descripcion, ii.cantidad ORDER BY ii.orden, ii.id) AS n
	FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
	WHERE i.order_id IS NOT NULL AND i.tipo::text LIKE 'factura%' AND ii.order_item_id IS NULL
), p AS (
	SELECT oi.id, oi.order_id, oi.descripcion, oi.cantidad,
		row_number() OVER (PARTITION BY oi.order_id, oi.descripcion, oi.cantidad ORDER BY oi.orden, oi.id) AS n
	FROM order_items oi
), ambiguos AS (
	SELECT order_id, descripcion, cantidad FROM order_items GROUP BY 1, 2, 3
	HAVING count(DISTINCT variant_id) > 1 OR (count(variant_id) > 0 AND count(variant_id) < count(*))
)
UPDATE invoice_items ii SET order_item_id = p.id
FROM f JOIN p ON p.order_id = f.order_id AND p.descripcion = f.descripcion AND p.cantidad = f.cantidad AND p.n = f.n
WHERE ii.id = f.id AND NOT EXISTS (SELECT 1 FROM ambiguos a WHERE a.order_id = f.order_id AND a.descripcion = f.descripcion
	AND a.cantidad = f.cantidad);

-- 2. Qué devolvió cada devolución, renglón por renglón: cuánto salió del
-- acopio (baja lo que falta entregar) y cuánto trajo el cliente, y si volvió
-- al stock. La cantidad de la nota no alcanza: no dice de dónde salió, y la
-- devolución de una venta facturada en homologación no lleva nota.
CREATE TABLE devolucion_items (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	devolucion_id uuid NOT NULL REFERENCES devoluciones(id) ON DELETE CASCADE,
	invoice_item_id uuid NOT NULL REFERENCES invoice_items(id),
	order_item_id uuid REFERENCES order_items(id) ON DELETE SET NULL,
	cantidad numeric(12, 3) NOT NULL CHECK (cantidad > 0),
	del_acopio numeric(12, 3) NOT NULL DEFAULT 0 CHECK (del_acopio >= 0 AND del_acopio <= cantidad),
	al_stock boolean NOT NULL,
	-- Lo que se devolvió de ese renglón (el subtotal, con IVA): lo que la
	-- nota habría acreditado, cuando no hay nota.
	importe numeric(12, 2) NOT NULL
);
CREATE INDEX devolucion_items_devolucion_idx ON devolucion_items (devolucion_id);
CREATE INDEX devolucion_items_order_item_idx ON devolucion_items (order_item_id) WHERE order_item_id IS NOT NULL;
CREATE INDEX devolucion_items_invoice_item_idx ON devolucion_items (invoice_item_id);

-- La devolución de una venta facturada con un CAE de prueba, con ARCA ya en
-- producción, no lleva nota: el original nunca tuvo valor fiscal. Y la plata
-- de lo cobrado con tarjeta, transferencia, Mercado Pago o cheque vuelve por
-- afuera de la caja: queda registrada y la caja no se toca.
ALTER TABLE devoluciones ALTER COLUMN nota_id DROP NOT NULL;
ALTER TABLE devoluciones DROP CONSTRAINT devoluciones_destino_check;
ALTER TABLE devoluciones ADD CONSTRAINT devoluciones_destino_check CHECK (destino IN ('caja', 'cuenta', 'afuera'));
CREATE INDEX devoluciones_nota_idx ON devoluciones (nota_id) WHERE nota_id IS NOT NULL;

-- 3. El padrón entero, no solo los clientes del día de la importación: el
-- que se da de alta el día 5 figuraba en el archivo y quedaba «sin padrón»
-- todo el mes. Son millones de filas, así que van sin id ni auditoría por
-- fila: eso queda en la importación.
ALTER TABLE padron_iibb DROP COLUMN id, DROP COLUMN cargado_por, DROP COLUMN cargado_at;
ALTER TABLE padron_iibb DROP CONSTRAINT padron_iibb_cuit_vigencia_desde_key, ADD PRIMARY KEY (cuit, vigencia_desde);

-- Cada archivo importado, con su vigencia: «hay padrón vigente» se decide
-- acá y no por si algún cliente figuraba.
CREATE TABLE padron_iibb_importaciones (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	vigencia_desde date NOT NULL,
	vigencia_hasta date NOT NULL CHECK (vigencia_hasta >= vigencia_desde),
	renglones integer NOT NULL CHECK (renglones > 0),
	cargado_por text REFERENCES "user"(id),
	cargado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX padron_iibb_importaciones_vigencia_idx ON padron_iibb_importaciones (vigencia_hasta);
INSERT INTO padron_iibb_importaciones (vigencia_desde, vigencia_hasta, renglones)
	SELECT vigencia_desde, max(vigencia_hasta), count(*) FROM padron_iibb GROUP BY vigencia_desde;

-- 4. Desde dónde arranca la posición de IVA: el primer mes que calcula el
-- sistema y los dos saldos a favor con que arranca, los de la última DDJJ
-- presentada. Los carga el contador y los vuelve a cargar cuando presenta:
-- lo declarado manda. Sin ellos la posición recorría desde el primer
-- registro de la base (con las compras de la puesta en marcha, que no
-- tienen débito) y el «A depositar» no coincidía con nada presentado.
ALTER TABLE configuracion_fiscal
	ADD COLUMN iva_desde date CHECK (iva_desde IS NULL OR extract(day FROM iva_desde) = 1),
	ADD COLUMN iva_saldo_tecnico numeric(14, 2) NOT NULL DEFAULT 0 CHECK (iva_saldo_tecnico >= 0),
	ADD COLUMN iva_saldo_libre numeric(14, 2) NOT NULL DEFAULT 0 CHECK (iva_saldo_libre >= 0),
	ADD COLUMN iva_anclado_at timestamptz;

-- +goose Down
ALTER TABLE configuracion_fiscal DROP COLUMN iva_desde, DROP COLUMN iva_saldo_tecnico, DROP COLUMN iva_saldo_libre,
	DROP COLUMN iva_anclado_at;
DROP TABLE padron_iibb_importaciones;
ALTER TABLE padron_iibb DROP CONSTRAINT padron_iibb_pkey;
ALTER TABLE padron_iibb ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ADD COLUMN cargado_por text REFERENCES "user"(id),
	ADD COLUMN cargado_at timestamptz NOT NULL DEFAULT now(), ADD CONSTRAINT padron_iibb_cuit_vigencia_desde_key UNIQUE (cuit, vigencia_desde);
DROP INDEX devoluciones_nota_idx;
ALTER TABLE devoluciones DROP CONSTRAINT devoluciones_destino_check;
ALTER TABLE devoluciones ADD CONSTRAINT devoluciones_destino_check CHECK (destino IN ('caja', 'cuenta'));
DROP TABLE devolucion_items;
