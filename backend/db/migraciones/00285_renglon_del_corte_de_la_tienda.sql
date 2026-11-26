-- +goose Up
-- Los renglones del corte que se compró en la tienda (mes simulado, CRT-3 de
-- PED-1116). La compra los guardaba sin `del_corte`, así que la ficha del
-- corte no veía la venta y cobraba otra vez «Fuera del pedido» las pasadas
-- que el pedido ya tenía. Ahora el checkout los marca; esto marca los de
-- antes con la regla de la 00175 (pasadas y tapacanto sin variante), solo en
-- pedidos que tienen un corte. La placa de esas compras no se distingue de
-- una placa suelta del carrito y queda como está.
UPDATE order_items oi SET del_corte = true
WHERE NOT oi.del_corte
  AND oi.variant_id IS NULL
  AND (oi.unidad = 'pasada' OR (oi.unidad = 'm' AND oi.descripcion LIKE 'Tapacanto%'))
  AND EXISTS (SELECT 1 FROM cutting_orders co WHERE co.order_id = oi.order_id);

-- +goose Down
SELECT 1;
