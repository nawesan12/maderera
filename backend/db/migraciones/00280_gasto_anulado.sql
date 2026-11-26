-- +goose Up
-- Un gasto mal cargado se anula (mes simulado): antes quedaba para siempre,
-- y uno en efectivo seguía descontado del cajón. Como el pago a proveedor,
-- no se borra: queda con quién, cuándo y por qué, y deja de contar en los
-- totales, el resultado y el cierre.
-- +goose StatementBegin
ALTER TABLE expenses
	ADD COLUMN anulado_at timestamptz,
	ADD COLUMN motivo_anulacion text,
	ADD COLUMN anulado_por_user_id text REFERENCES "user" (id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE expenses DROP COLUMN anulado_por_user_id, DROP COLUMN motivo_anulacion, DROP COLUMN anulado_at;
-- +goose StatementEnd
