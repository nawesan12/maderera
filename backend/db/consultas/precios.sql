-- La gestión de precios del panel (internal/precios).

-- name: ListasDelPanel :many
SELECT id, slug, name, is_default, active, created_at, porcentaje_sobre_general
FROM price_lists ORDER BY is_default DESC;

-- name: PreciosDeLasVariantes :many
SELECT variant_id, price_list_id, price::text AS price, updated_at
FROM price_list_items WHERE variant_id = ANY(sqlc.arg(ids)::uuid[]);

-- name: PortadasDe :many
SELECT DISTINCT ON (product_id) product_id, url FROM product_images
WHERE product_id = ANY(sqlc.arg(ids)::uuid[]) ORDER BY product_id, sort_order;

-- name: HistorialDePrecios :many
SELECT h.id, v.sku, p.name AS producto, v.label AS medida, l.name AS lista,
  h.precio_anterior, h.precio_nuevo, h.origen, h.motivo, h.created_at
FROM price_history h
JOIN product_variants v ON v.id = h.variant_id
JOIN products p ON p.id = v.product_id
JOIN price_lists l ON l.id = h.price_list_id
ORDER BY h.created_at DESC
LIMIT $1;

-- name: RubrosParaAjuste :many
SELECT s.slug, s.name, c.slug AS category_slug
FROM subcategories s JOIN categories c ON c.id = s.category_id
WHERE s.active ORDER BY s.sort_order, s.name;

-- name: PrecioActual :one
SELECT price::text AS price FROM price_list_items WHERE variant_id = $1 AND price_list_id = $2;

-- name: FijarPrecio :exec
INSERT INTO price_list_items (variant_id, price_list_id, price, updated_at)
VALUES ($1, $2, sqlc.arg(price)::text::numeric, now())
ON CONFLICT (price_list_id, variant_id) DO UPDATE SET price = excluded.price, updated_at = now();

-- name: AnotarPrecio :exec
INSERT INTO price_history (variant_id, price_list_id, precio_anterior, precio_nuevo, origen, motivo, lote_id, created_by_user_id)
VALUES ($1, $2, sqlc.narg(anterior)::text::numeric, sqlc.arg(nuevo)::text::numeric, $3, $4, $5, $6);

-- name: VariantesParaAjuste :many
SELECT v.id, vc.costo_promedio AS costo, p.recargo_elaboracion_pct AS recargo
FROM product_variants v
JOIN products p ON p.id = v.product_id
JOIN categories c ON c.id = p.category_id
LEFT JOIN subcategories s ON s.id = p.subcategory_id
LEFT JOIN variant_costs vc ON vc.variant_id = v.id
WHERE p.active AND v.active
  AND (sqlc.narg(categoria)::text IS NULL OR c.slug = sqlc.narg(categoria))
  AND (sqlc.narg(rubro)::text IS NULL OR s.slug = sqlc.narg(rubro));

-- name: PreciosDeLista :many
SELECT variant_id, price::text AS price FROM price_list_items
WHERE price_list_id = $1 AND variant_id = ANY(sqlc.arg(ids)::uuid[]);

-- name: VariantesPorSKU :many
SELECT v.id, v.sku, p.name AS producto, v.label AS medida
FROM product_variants v JOIN products p ON p.id = v.product_id
WHERE v.sku = ANY(sqlc.arg(skus)::text[]);

-- name: ListaPorIDDelPanel :one
SELECT name, is_default FROM price_lists WHERE id = $1;

-- name: FijarPorcentajeDeLista :exec
UPDATE price_lists SET porcentaje_sobre_general = sqlc.narg(porcentaje)::text::numeric WHERE id = $1;

-- name: CrearDescuentoDePago :exec
INSERT INTO payment_discounts (medio, desde_monto, porcentaje, etiqueta, activo)
VALUES ($1, sqlc.arg(desde)::text::numeric, sqlc.arg(porcentaje)::text::numeric, $2, $3);

-- name: EditarDescuentoDePago :exec
UPDATE payment_discounts SET medio = $2, desde_monto = sqlc.arg(desde)::text::numeric,
  porcentaje = sqlc.arg(porcentaje)::text::numeric, etiqueta = $3, activo = $4
WHERE id = $1;

-- name: DescuentosDePago :many
-- Todos los escalones, también los apagados, para el panel.
SELECT * FROM payment_discounts ORDER BY medio, desde_monto;

-- name: ItemsPorLista :many
SELECT price_list_id, count(*)::int AS cuantos FROM price_list_items GROUP BY price_list_id;
