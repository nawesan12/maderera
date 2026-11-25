-- +goose Up
-- El teléfono de quien encarga el corte y el día que lo retira. Sin ficha de
-- cliente no había a quién avisarle «tu corte está listo», y el día de
-- retiro iba mezclado en las notas.
ALTER TABLE cutting_orders ADD COLUMN contacto_telefono text;
ALTER TABLE cutting_orders ADD COLUMN retira_el date;

-- +goose Down
ALTER TABLE cutting_orders DROP COLUMN retira_el;
ALTER TABLE cutting_orders DROP COLUMN contacto_telefono;
