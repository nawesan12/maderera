-- +goose Up

-- El cálculo de cada retención, para que el certificado y el CSV se puedan
-- seguir: la retención sale de (acumulado del mes − mínimo no imponible) ×
-- alícuota − lo ya retenido en el mes, y con solo la base del pago a la vista
-- no cierra. Se guarda lo que se usó en el momento, no se recalcula: un pago
-- anulado después cambia el acumulado de hoy, no el de ese día.
--   acumulado: las bases del mes con la de este pago incluida.
--   imponible: el monto sujeto a retención (acumulado − mínimo no imponible).
--   retenido_antes: lo retenido en el mes antes de este certificado.
-- Las de antes quedan en null: el certificado se imprime como antes.
ALTER TABLE retenciones_practicadas ADD COLUMN acumulado numeric(14, 2);
ALTER TABLE retenciones_practicadas ADD COLUMN imponible numeric(14, 2);
ALTER TABLE retenciones_practicadas ADD COLUMN retenido_antes numeric(14, 2);

-- Un certificado anulado (porque se anuló su pago) no cuenta para el
-- acumulado del mes, el CSV ni el cierre. El número no se reusa.
ALTER TABLE retenciones_practicadas ADD COLUMN anulada_at timestamptz;

-- El pago a proveedor anulado: queda la fila (con su motivo) y deja de
-- contar. La deuda vuelve con un movimiento de cuenta.
ALTER TABLE supplier_payments ADD COLUMN anulado_at timestamptz;
ALTER TABLE supplier_payments ADD COLUMN motivo_anulacion text;
ALTER TABLE supplier_payments ADD COLUMN anulado_por_user_id text REFERENCES "user"(id);

-- +goose Down
ALTER TABLE supplier_payments DROP COLUMN anulado_por_user_id;
ALTER TABLE supplier_payments DROP COLUMN motivo_anulacion;
ALTER TABLE supplier_payments DROP COLUMN anulado_at;
ALTER TABLE retenciones_practicadas DROP COLUMN anulada_at;
ALTER TABLE retenciones_practicadas DROP COLUMN retenido_antes;
ALTER TABLE retenciones_practicadas DROP COLUMN imponible;
ALTER TABLE retenciones_practicadas DROP COLUMN acumulado;
