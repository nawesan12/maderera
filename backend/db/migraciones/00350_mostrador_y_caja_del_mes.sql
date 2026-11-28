-- +goose Up
-- Lo que encontró el segundo y el tercer mes simulado en el mostrador y la
-- caja (rama mes23-mostrador-caja).

-- 1. De dónde salió una devolución parcial: el mostrador o el panel. El
--    cierre Z del turno mostraba la que hizo atención desde el panel a cuenta
--    corriente como si hubiera salido de ese puesto (mes simulado, M3S2-061).
--    Las de antes quedan nulas y se leen como antes.
-- +goose StatementBegin
ALTER TABLE devoluciones ADD COLUMN origen text CHECK (origen IS NULL OR origen IN ('mostrador', 'panel'));
-- +goose StatementEnd

-- 2. El ingreso también dice de dónde viene (de la caja fuerte, del banco u
--    otro), como el retiro dice adónde va: el ingreso suelto no dejaba asiento
--    (M3S3-014). Y el retiro «otro» que es un pago lleva su categoría de
--    gasto: el flete pagado del cajón no aparecía en ningún archivo (M3S1-005).
-- +goose StatementBegin
ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_check;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_destino_check
	CHECK (destino IS NULL OR (destino IN ('banco', 'caja_fuerte', 'otro') AND tipo IN ('retiro', 'ingreso')));
-- +goose StatementEnd

-- 3. La corrección del conteo de un turno ya cerrado, hecha al abrir el
--    siguiente («ayer conté mal»). Se cargaba como un retiro sin destino: la
--    caja fuerte sumaba plata que no existía y el sobrante falso quedaba como
--    ganancia (M2S3-002). Lo contado de entonces no se pisa: queda al lado,
--    con quién lo corrigió, cuándo y por qué.
-- +goose StatementBegin
ALTER TABLE cash_sessions
	ADD COLUMN contado_corregido numeric(12, 2),
	ADD COLUMN correccion_motivo text,
	ADD COLUMN corregido_por text REFERENCES "user" (id),
	ADD COLUMN corregido_at timestamptz;
-- +goose StatementEnd

-- 4. Con cuánto pagó el cliente en efectivo: el vuelto quedaba solo en la
--    pantalla, y ni el ticket ni la reimpresión lo decían (M3S1-061).
-- +goose StatementBegin
ALTER TABLE orders ADD COLUMN efectivo_recibido numeric(12, 2) CHECK (efectivo_recibido IS NULL OR efectivo_recibido >= 0);
-- +goose StatementEnd

-- 5. El presupuesto del mostrador con su clave por intento: el segundo toque
--    emitía otro igual, con su correo al cliente (M3S2-050).
-- +goose StatementBegin
ALTER TABLE quotes ADD COLUMN clave_mostrador text;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX quotes_clave_mostrador_idx ON quotes (clave_mostrador) WHERE clave_mostrador IS NOT NULL;
-- +goose StatementEnd

-- 6. Lo que sale de la caja fuerte (el depósito en el banco): sin esto, la
--    caja fuerte solo sumaba y ninguna pantalla podía decir cuánto tiene
--    (M3S1-005). Lo que entra son los retiros de las cajas con destino
--    «caja_fuerte»; lo que vuelve a una caja, los ingresos que vienen de ahí.
-- +goose StatementBegin
CREATE TABLE caja_fuerte_movimientos (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	branch_id uuid NOT NULL REFERENCES branches (id),
	tipo text NOT NULL CHECK (tipo IN ('deposito')),
	monto numeric(12, 2) NOT NULL CHECK (monto > 0),
	motivo text NOT NULL,
	clave text NOT NULL,
	created_by_user_id text REFERENCES "user" (id),
	created_at timestamptz NOT NULL DEFAULT now()
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX caja_fuerte_movimientos_clave_idx ON caja_fuerte_movimientos (clave);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX caja_fuerte_movimientos_fecha_idx ON caja_fuerte_movimientos (created_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE caja_fuerte_movimientos;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX quotes_clave_mostrador_idx;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE quotes DROP COLUMN clave_mostrador;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE orders DROP COLUMN efectivo_recibido;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE cash_sessions DROP COLUMN corregido_at, DROP COLUMN corregido_por, DROP COLUMN correccion_motivo, DROP COLUMN contado_corregido;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE cash_movements DROP CONSTRAINT cash_movements_destino_check;
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE cash_movements SET destino = NULL WHERE tipo <> 'retiro';
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_check
	CHECK (destino IS NULL OR (destino IN ('banco', 'caja_fuerte', 'otro') AND tipo = 'retiro'));
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE devoluciones DROP COLUMN origen;
-- +goose StatementEnd
