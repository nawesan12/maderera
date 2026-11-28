-- +goose Up
-- Un ajuste que baja la deuda (una bonificación pactada, M3S2-028) se puede
-- aplicar a una factura, como una nota de crédito: la factura queda pagada y
-- la ficha deja de decir «Se le debe $ 0» con «Facturas por pagar» abajo.
ALTER TABLE supplier_movements ADD COLUMN aplica_a_id uuid REFERENCES purchase_invoices (id) ON DELETE SET NULL;
CREATE INDEX supplier_movements_aplica_a_idx ON supplier_movements (aplica_a_id) WHERE aplica_a_id IS NOT NULL;

-- Un ajuste que sube la deuda (un saldo inicial) se paga como una factura
-- (M2S1-125): el pago dice qué canceló y no queda «A cuenta, sin aplicar».
CREATE TABLE supplier_payment_ajustes (
	payment_id uuid NOT NULL REFERENCES supplier_payments (id) ON DELETE CASCADE,
	movement_id uuid NOT NULL REFERENCES supplier_movements (id),
	importe numeric(14, 2) NOT NULL,
	PRIMARY KEY (payment_id, movement_id)
);

-- Lo que cubría un pago cuando se anuló (M2S2-078): las imputaciones se
-- borran para que las facturas vuelvan a tener saldo, y la ficha del pago
-- anulado mostraba «A cuenta, sin aplicar».
CREATE TABLE supplier_payment_anulado_items (
	payment_id uuid NOT NULL REFERENCES supplier_payments (id) ON DELETE CASCADE,
	purchase_invoice_id uuid REFERENCES purchase_invoices (id) ON DELETE SET NULL,
	cheque_id uuid REFERENCES cheques (id) ON DELETE SET NULL,
	movement_id uuid REFERENCES supplier_movements (id) ON DELETE SET NULL,
	importe numeric(14, 2) NOT NULL
);
CREATE INDEX supplier_payment_anulado_items_pago_idx ON supplier_payment_anulado_items (payment_id);

-- +goose Down
DROP TABLE supplier_payment_anulado_items;
DROP TABLE supplier_payment_ajustes;
DROP INDEX supplier_movements_aplica_a_idx;
ALTER TABLE supplier_movements DROP COLUMN aplica_a_id;
