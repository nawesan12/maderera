-- +goose Up
-- La sucursal de la caja que cobró la venta del mostrador. La venta que solo
-- cobra un corte pasa a la sucursal del corte (se retira donde está), pero su
-- plata entró al cajón de la que cobró: el Z del Aserradero sumaba en
-- «Cobrado en el turno» ventas de Casa Central que no pasaron por su cajón, y
-- no cuadraba con «Ventas en efectivo» (mes 23, PED-1142 y PED-1160).
-- NULL es «la misma que branch_id» (las de antes y las que no cambiaron).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS caja_branch_id uuid REFERENCES branches (id) ON DELETE SET NULL;

-- Las que ya cambiaron de sucursal y entraron a un cajón: la caja es la del
-- turno donde está su efectivo.
UPDATE orders o SET caja_branch_id = s.branch_id
FROM cash_movements m
JOIN cash_sessions s ON s.id = m.session_id
WHERE m.order_id = o.id AND m.tipo = 'venta' AND o.origen = 'mostrador'
  AND o.branch_id IS DISTINCT FROM s.branch_id AND o.caja_branch_id IS NULL;

-- +goose Down
ALTER TABLE orders DROP COLUMN IF EXISTS caja_branch_id;
