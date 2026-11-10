-- +goose Up
-- Lo que encontró la revisión del link mágico (10/11/2026):
--   cuenta_creada: la aprobación creó la cuenta (sin clave) para esta
--     solicitud. El link de acceso por WhatsApp sale solo para esas: una
--     solicitud anónima con el correo de otra persona no puede llevarse un
--     link a una cuenta que no creó.
--   El índice: cada «mandame un link» suma una fila y el borrado por
--     identifier recorría la tabla entera. La limpieza de los vencidos la
--     hace la tarea diaria.
ALTER TABLE professional_applications ADD COLUMN cuenta_creada boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier);
CREATE INDEX IF NOT EXISTS verification_expires_at_idx ON verification (expires_at);

-- +goose Down
DROP INDEX IF EXISTS verification_expires_at_idx;
DROP INDEX IF EXISTS verification_identifier_idx;
ALTER TABLE professional_applications DROP COLUMN cuenta_creada;
