-- +goose Up
-- Un ajuste que baja la deuda se aplica también a un ajuste que la subió
-- (recorrido M4-036): con «Sube $ 150.000» y «Baja $ 150.000» el saldo
-- quedaba en cero, pero el primero seguía en «Facturas por pagar» y en Pagos,
-- y se le podía pagar a alguien a quien no se le debía nada.
ALTER TABLE supplier_movements ADD COLUMN aplica_a_ajuste_id uuid REFERENCES supplier_movements (id) ON DELETE SET NULL;
CREATE INDEX supplier_movements_aplica_a_ajuste_idx ON supplier_movements (aplica_a_ajuste_id) WHERE aplica_a_ajuste_id IS NOT NULL;

-- +goose Down
DROP INDEX supplier_movements_aplica_a_ajuste_idx;
ALTER TABLE supplier_movements DROP COLUMN aplica_a_ajuste_id;
