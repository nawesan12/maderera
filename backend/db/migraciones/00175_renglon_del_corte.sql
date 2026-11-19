-- +goose Up
-- Si el renglón de la venta salió de un corte (revisión del carril F).
--
-- «El personal · 7 días» muestra los renglones cargados a mano por vendedor
-- (comité final, M12). Hasta acá se reconocían por lo que no eran: sin
-- variante, y ni en «pasada» ni en metros de «Tapacanto…», que es como
-- llegan las pasadas y el canto del corte. Pero «Cargar a mano» deja
-- escribir cualquier unidad, y un renglón a mano en «pasada» salía del
-- control. Ahora lo dice la venta: el renglón atado a un despiece
-- (`corte` en la venta del mostrador) es del corte; todo lo demás sin
-- variante, es a mano.
--
-- Lo de antes se marca con la regla de antes: es lo único que se sabe de
-- esas ventas, y el control mira siete días.
ALTER TABLE order_items ADD COLUMN del_corte boolean NOT NULL DEFAULT false;

UPDATE order_items SET del_corte = true
WHERE variant_id IS NULL AND (unidad = 'pasada' OR (unidad = 'm' AND descripcion LIKE 'Tapacanto%'));

-- +goose Down
ALTER TABLE order_items DROP COLUMN del_corte;
