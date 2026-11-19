-- +goose Up
-- Cuando cambia el stock, el catálogo cacheado de Next se entera (tanda T8).
--
-- Hasta acá una venta del mostrador, una entrega o una compra de la tienda
-- movían el stock y el sitio seguía diciendo «en stock» hasta que alguien
-- editaba algo en el panel o vencía la caché, un día después.
--
-- **Trigger y no llamadas en el código**, por lo mismo que los de la 00075:
-- el stock lo mueven la venta, la anulación, la devolución, la recepción de
-- una compra, la transferencia entre sucursales, el ajuste, la reserva de la
-- tienda y la migración de ISIS. Con el aviso en la tabla, ningún camino
-- —tampoco uno nuevo— se olvida de avisar. Va en la misma transacción del
-- cambio: si se deshace, el aviso también.
--
-- **Un solo aviso pendiente, que junta etiquetas.** Avisar por cada venta
-- rearmaría el listado entero varias veces por minuto en un sábado. El
-- primer cambio deja un trabajo `next.revalidar` para dentro de dos minutos;
-- los que llegan mientras tanto le suman sus etiquetas a ese mismo trabajo.
-- Las etiquetas son finas (lib/cache-publico.ts): el listado de la
-- categoría, la ficha del producto y el listado de «todo» —el stock cambia
-- los filtros «en stock» y el orden por relevancia de cualquier listado que
-- lo incluya—.
--
-- **Sin esperar a nadie.** El pendiente se busca con SKIP LOCKED: si otra
-- transacción lo tiene tomado (otra venta sumándole lo suyo, o el worker que
-- lo está mandando), esta no espera y deja su propio aviso. Esperar ahí era
-- un abrazo mortal con los candados del stock: la venta A espera el aviso que
-- tiene B, y B espera la fila de inventario que tiene A. Un aviso de más no
-- hace daño; uno que falta deja el sitio mintiendo. Por lo mismo, solo se
-- suma a un trabajo que el worker todavía no tomó (`intentos = 0`): si ya lo
-- está mandando, lo de esta venta va en uno nuevo.
--
-- Más de 200 etiquetas (la migración de ISIS, un ajuste masivo) se vuelven
-- `catalogo` a secas: rearmar todo es más barato que invalidar de a una.
-- +goose StatementBegin
CREATE FUNCTION mjbj_stock_avisa() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  nuevas jsonb;
  pendiente uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Solo lo que cambió de verdad: recalcular el reservado toca filas sin
    -- moverlas, y eso no tiene por qué invalidar nada.
    SELECT jsonb_agg(DISTINCT e) INTO nuevas FROM (
      SELECT unnest(ARRAY['catalogo:' || c.slug, 'producto:' || p.slug]) AS e
      FROM mjbj_despues d
      JOIN mjbj_antes a ON a.id = d.id
      JOIN product_variants v ON v.id = d.variant_id
      JOIN products p ON p.id = v.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE (d.qty, d.reservado, d.min_qty, d.branch_id) IS DISTINCT FROM (a.qty, a.reservado, a.min_qty, a.branch_id)
    ) x;
  ELSE
    SELECT jsonb_agg(DISTINCT e) INTO nuevas FROM (
      SELECT unnest(ARRAY['catalogo:' || c.slug, 'producto:' || p.slug]) AS e
      FROM mjbj_despues d
      JOIN product_variants v ON v.id = d.variant_id
      JOIN products p ON p.id = v.product_id
      JOIN categories c ON c.id = p.category_id
    ) x;
  END IF;
  IF nuevas IS NULL THEN
    RETURN NULL;
  END IF;
  nuevas := nuevas || '["catalogo:todo"]'::jsonb;

  SELECT id INTO pendiente FROM trabajos
   WHERE tipo = 'next.revalidar' AND estado = 'pendiente' AND intentos = 0 AND carga->>'agrupa' = 'stock'
   ORDER BY proximo_intento_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF pendiente IS NULL THEN
    INSERT INTO trabajos (tipo, carga, proximo_intento_at)
    VALUES ('next.revalidar', jsonb_build_object('agrupa', 'stock', 'etiquetas', mjbj_etiquetas_juntas('[]'::jsonb, nuevas)),
            now() + interval '2 minutes');
  ELSE
    UPDATE trabajos SET carga = jsonb_set(carga, '{etiquetas}', mjbj_etiquetas_juntas(carga->'etiquetas', nuevas))
     WHERE id = pendiente;
  END IF;
  RETURN NULL;
END;
$$;
-- +goose StatementEnd
-- +goose StatementBegin
-- La unión de dos listas de etiquetas, sin repetir y ordenada. Con
-- `catalogo` a secas adentro, las finas sobran; con más de 200, también.
CREATE FUNCTION mjbj_etiquetas_juntas(a jsonb, b jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN bool_or(e = 'catalogo') OR count(*) > 200 THEN '["catalogo"]'::jsonb
    ELSE coalesce(jsonb_agg(e ORDER BY e), '[]'::jsonb)
  END
  FROM (SELECT DISTINCT jsonb_array_elements_text(coalesce(a, '[]'::jsonb) || coalesce(b, '[]'::jsonb)) AS e) x
$$;
-- +goose StatementEnd
-- Dos triggers y no uno: Postgres no deja usar tablas de transición en un
-- trigger de más de un evento.
-- +goose StatementBegin
CREATE TRIGGER mjbj_stock_avisa_alta AFTER INSERT ON inventory
  REFERENCING NEW TABLE AS mjbj_despues
  FOR EACH STATEMENT EXECUTE FUNCTION mjbj_stock_avisa();
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER mjbj_stock_avisa_cambio AFTER UPDATE ON inventory
  REFERENCING OLD TABLE AS mjbj_antes NEW TABLE AS mjbj_despues
  FOR EACH STATEMENT EXECUTE FUNCTION mjbj_stock_avisa();
-- +goose StatementEnd

-- +goose Down
DROP TRIGGER mjbj_stock_avisa_cambio ON inventory;
DROP TRIGGER mjbj_stock_avisa_alta ON inventory;
DROP FUNCTION mjbj_stock_avisa();
DROP FUNCTION mjbj_etiquetas_juntas(jsonb, jsonb);
