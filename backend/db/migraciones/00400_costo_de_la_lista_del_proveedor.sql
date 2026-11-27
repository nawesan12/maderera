-- +goose Up
-- El costo que trae la lista del proveedor (mes simulado, M3S2-029): aplicar
-- la planilla guardaba el código y el precio de venta, pero no el costo, y
-- la orden siguiente al mismo proveedor sugería «sin costo». Queda en el
-- código del proveedor, neto de IVA, como el costo de reposición de esa
-- variante con ese proveedor.
ALTER TABLE supplier_variant_codes ADD COLUMN costo_neto numeric(14, 4);
ALTER TABLE supplier_variant_codes ADD COLUMN costo_at timestamp with time zone;

-- +goose Down
ALTER TABLE supplier_variant_codes DROP COLUMN costo_at;
ALTER TABLE supplier_variant_codes DROP COLUMN costo_neto;
