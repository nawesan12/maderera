-- El catálogo público (internal/catalogo): lib/dal/catalog.ts y
-- lib/dal/precios-sesion.ts. El listado de productos, que arma el WHERE según
-- los filtros, está en internal/catalogo/productos.go (SQL armado, con pgx).

-- name: ListaGeneral :one
SELECT id, name FROM price_lists WHERE is_default AND active LIMIT 1;

-- name: ListaDeLaFicha :one
SELECT price_list_id FROM customers WHERE user_id = $1 AND active LIMIT 1;

-- name: ListaPorID :one
SELECT id, name, porcentaje_sobre_general FROM price_lists WHERE id = $1 AND active LIMIT 1;

-- name: CondicionIvaDelPerfil :one
SELECT condicion_iva FROM profiles WHERE user_id = $1 LIMIT 1;

-- name: CondicionIvaDeLaFicha :one
SELECT condicion_iva FROM customers WHERE user_id = $1 AND active LIMIT 1;

-- name: Categorias :many
SELECT c.id, c.slug, c.name, c.description, c.icon, c.image, count(p.id)::int AS product_count
FROM categories c
LEFT JOIN products p ON p.category_id = c.id AND p.active
WHERE c.active
GROUP BY c.id
ORDER BY c.sort_order;

-- name: Marcas :many
SELECT p.brand::text AS nombre, count(p.id)::int AS product_count
FROM products p
JOIN categories c ON c.id = p.category_id
WHERE p.active AND p.brand IS NOT NULL AND p.brand <> ''
  AND (sqlc.narg(categoria)::text IS NULL OR c.slug = sqlc.narg(categoria))
GROUP BY p.brand
ORDER BY count(p.id) DESC, p.brand;

-- name: RubrosDeCategoria :many
SELECT s.slug, s.name, count(p.id)::int AS product_count
FROM subcategories s
JOIN categories c ON c.id = s.category_id
JOIN products p ON p.subcategory_id = s.id AND p.active
WHERE c.slug = $1 AND s.active
GROUP BY s.id
ORDER BY s.sort_order, s.name;

-- name: NumerosDeLaEmpresa :one
SELECT (SELECT count(*) FROM products WHERE active)::int AS productos,
       (SELECT count(*) FROM product_variants WHERE active)::int AS medidas,
       (SELECT count(*) FROM branches WHERE active)::int AS sucursales,
       (SELECT count(*) FROM categories WHERE active)::int AS rubros;

-- name: Vinculos :many
SELECT related_product_id, tipo FROM related_products WHERE product_id = $1 ORDER BY orden;

-- name: ProductosDeVariantes :many
SELECT DISTINCT product_id FROM product_variants WHERE id = ANY(sqlc.arg(ids)::uuid[]);

-- name: ComplementariosDe :many
SELECT related_product_id FROM related_products
WHERE product_id = ANY(sqlc.arg(productos)::uuid[]) AND tipo = 'complementario'
ORDER BY orden;

-- name: PreciosDeVariante :many
-- El precio de cada variante para una lista: el propio, o el general por el
-- factor de una lista derivada. Como texto, tal como lo devolvía drizzle.
SELECT v.id,
       coalesce(pr.price, round((g.price * sqlc.arg(factor)::numeric)::numeric, 2))::text AS precio
FROM product_variants v
JOIN products p ON p.id = v.product_id AND p.active
LEFT JOIN price_list_items pr ON pr.variant_id = v.id AND pr.price_list_id = sqlc.narg(lista)::uuid
LEFT JOIN price_list_items g ON g.variant_id = v.id AND g.price_list_id = sqlc.narg(general)::uuid
WHERE v.active AND coalesce(pr.price, g.price) IS NOT NULL;
