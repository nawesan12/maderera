-- +goose Up
-- La nota «Cuenta creada con cliente:create.» sale de las fichas (comité
-- final). La ponía el alta de una cuenta sin ficha, con el nombre del
-- comando del sistema viejo, y era lo primero que se leía en la ficha del
-- cliente. Solo se borra si la nota es exactamente esa: lo que alguien
-- escribió después se deja.
-- +goose StatementBegin
UPDATE customers SET notas = NULL WHERE notas = 'Cuenta creada con cliente:create.';
-- +goose StatementEnd

-- +goose Down
-- No hay vuelta: la nota no decía nada que hiciera falta.
-- +goose StatementBegin
SELECT 1;
-- +goose StatementEnd
