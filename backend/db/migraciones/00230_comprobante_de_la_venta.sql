-- +goose Up
-- Con qué comprobante salió la venta del mostrador (mes simulado,
-- 26/11/2026). El mostrador elige «Comprobante» (el interno) o «Factura» al
-- cobrar, y eso no se guardaba: la dueña veía trece ventas pagadas con
-- «Facturar» y no sabía cuáles salieron por el circuito interno a propósito
-- y cuáles se olvidaron de facturar. Nula: la venta es anterior, o no es del
-- mostrador.
ALTER TABLE orders ADD COLUMN comprobante text CHECK (comprobante IN ('interno', 'fiscal'));

-- +goose Down
ALTER TABLE orders DROP COLUMN comprobante;
