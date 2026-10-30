-- +goose Up
-- Los reintegros parciales de un pago online. Mercado Pago deja el pago
-- aprobado y suma lo devuelto en transaction_amount_refunded; acá queda cada
-- tramo que ya se aplicó, para devolverlo una sola vez aunque el aviso
-- llegue repetido, y para que el cierre lo asiente en su fecha.
--
-- acumulado es el transaction_amount_refunded que trajo el aviso: el índice
-- único es la segunda defensa (la primera es el candado del pago).
CREATE TABLE payment_refunds (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
	importe numeric(12, 2) NOT NULL,
	acumulado numeric(12, 2) NOT NULL,
	referencia text,
	account_movement_id uuid REFERENCES account_movements(id) ON DELETE SET NULL,
	created_at timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX payment_refunds_acumulado_idx ON payment_refunds (payment_id, acumulado);
CREATE INDEX payment_refunds_created_idx ON payment_refunds (created_at);

-- +goose Down
DROP TABLE payment_refunds;
