-- T4, hallazgo 23: la media placa pasa a descontar el disco que la parte.
--
-- PASO OBLIGATORIO ANTES DE DESPLEGAR T4. Solo lee: no cambia nada.
--
-- El plano de un trabajo se recalcula al leerlo. Un trabajo en cola que sale
-- de media placa y tiene una pieza justo de la mitad vieja (610 de una 1220)
-- va a aparecer como «no entra» después del despliegue, aunque ya se le haya
-- vendido —y quizá cobrado— al cliente. Esta consulta los lista. Si devuelve
-- filas, hay que decidir con cada uno ANTES de desplegar (cambiar el disco
-- desde /admin/cortes/<id>, pasarlo a placa entera, o hablar con el cliente):
-- la pieza, en el depósito, tampoco entraba.
--
-- Uso: psql "$DATABASE_URL" -f scripts/sql/t4-media-placa-en-cola.sql
WITH trabajos AS (
  SELECT co.id, co.numero, co.contacto_nombre, co.mitad::text AS mitad,
         co.ancho_sierra_mm::float8 AS sierra,
         CASE WHEN co.placa_largo_mm > 0 AND co.placa_ancho_mm > 0 THEN co.placa_largo_mm
              WHEN pv.largo_mm > 0 AND pv.ancho_mm > 0 THEN pv.largo_mm ELSE 2750 END AS largo,
         CASE WHEN co.placa_largo_mm > 0 AND co.placa_ancho_mm > 0 THEN co.placa_ancho_mm
              WHEN pv.largo_mm > 0 AND pv.ancho_mm > 0 THEN pv.ancho_mm ELSE 1830 END AS ancho
  FROM cutting_orders co
  LEFT JOIN product_variants pv ON pv.id = co.variant_id
  WHERE co.estado = 'en-cola' AND co.mitad IS NOT NULL
), medidas AS (
  SELECT t.*,
         CASE WHEN mitad = 'ancho' THEN floor(largo / 2.0) ELSE largo END AS largo_viejo,
         CASE WHEN mitad = 'largo' THEN floor(ancho / 2.0) ELSE ancho END AS ancho_viejo,
         CASE WHEN mitad = 'ancho' THEN floor((largo - sierra) / 2.0) ELSE largo END AS largo_nuevo,
         CASE WHEN mitad = 'largo' THEN floor((ancho - sierra) / 2.0) ELSE ancho END AS ancho_nuevo
  FROM trabajos t
)
SELECT m.numero, m.contacto_nombre, m.mitad, m.sierra,
       m.largo_viejo || ' × ' || m.ancho_viejo AS media_vieja,
       m.largo_nuevo || ' × ' || m.ancho_nuevo AS media_nueva,
       ci.largo_mm || ' × ' || ci.ancho_mm AS pieza, ci.cantidad, ci.respeta_veta
FROM medidas m
JOIN cutting_items ci ON ci.cutting_order_id = m.id
-- Entraba en la mitad vieja (derecha o girada, si la veta lo deja)...
WHERE ((ci.largo_mm <= m.largo_viejo AND ci.ancho_mm <= m.ancho_viejo)
       OR (ci.respeta_veta = 0 AND ci.ancho_mm <= m.largo_viejo AND ci.largo_mm <= m.ancho_viejo))
-- ...y no entra en la nueva.
  AND NOT ((ci.largo_mm <= m.largo_nuevo AND ci.ancho_mm <= m.ancho_nuevo)
       OR (ci.respeta_veta = 0 AND ci.ancho_mm <= m.largo_nuevo AND ci.largo_mm <= m.ancho_nuevo))
ORDER BY m.numero, ci.orden;
