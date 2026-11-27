-- +goose Up
-- Lo que liquida la tarjeta (mes simulado, M2S1-058): lo cobrado con tarjeta
-- va a Tarjetas a acreditar el día de la venta y pasa al Banco, neto de la
-- comisión, el día que la tarjeta liquida. Antes entraba al Banco el mismo
-- día de la venta y el extracto no conciliaba.
CREATE TABLE liquidaciones_tarjeta (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	fecha timestamptz NOT NULL,
	bruto numeric(14, 2) NOT NULL CHECK (bruto > 0),
	comision numeric(14, 2) NOT NULL DEFAULT 0 CHECK (comision >= 0 AND comision < bruto),
	referencia text,
	circuito circuito NOT NULL DEFAULT 'blanco',
	created_by_user_id text,
	created_at timestamptz NOT NULL DEFAULT now(),
	anulada_at timestamptz
);
CREATE INDEX liquidaciones_tarjeta_fecha_idx ON liquidaciones_tarjeta (fecha);

-- +goose Down
DROP TABLE liquidaciones_tarjeta;
