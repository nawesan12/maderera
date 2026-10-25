-- La gestión de productos del panel (internal/productos).

-- name: ProductoPorID :one
-- Con las formas de drizzle: alicuota_iva y recargo_elaboracion_pct como
-- texto («21.00»), precio_media_pct como número.
SELECT id, slug, name, category_id, subcategory, description, brand, unit::text AS unit, featured, active,
  created_at, updated_at, alicuota_iva::text AS alicuota_iva, a_pedido, subcategory_id,
  recargo_elaboracion_pct, imputacion, forma_de_venta::text AS forma_de_venta, precio_media_pct
FROM products WHERE id = $1;

-- name: ImagenesDelProducto :many
SELECT id, url, alt, sort_order FROM product_images WHERE product_id = $1 ORDER BY sort_order;

-- name: VariantesDelProducto :many
SELECT * FROM product_variants WHERE product_id = $1 ORDER BY sort_order;

-- name: ListasDePrecios :many
SELECT id, slug, name, is_default FROM price_lists;

-- name: Sucursales :many
SELECT id, slug FROM branches ORDER BY sort_order;

-- name: PreciosDeVariantes :many
SELECT price_list_id, variant_id, price::text AS price FROM price_list_items WHERE variant_id = ANY(sqlc.arg(ids)::uuid[]);

-- name: StockDeVariantes :many
SELECT variant_id, branch_id, qty, min_qty FROM inventory WHERE variant_id = ANY(sqlc.arg(ids)::uuid[]);

-- name: CategoriasAdmin :many
SELECT id, slug, name FROM categories ORDER BY sort_order;

-- name: RubrosAdmin :many
SELECT id, category_id, slug, name, active FROM subcategories ORDER BY sort_order, name;

-- name: ConteoPorRubro :many
SELECT subcategory_id, count(*)::int AS cuantos FROM products WHERE active GROUP BY subcategory_id;

-- name: SueltosPorTexto :many
-- Los que nombran un rubro como texto y no lo tienen asignado.
SELECT category_id, lower(unaccent(subcategory))::text AS texto, count(*)::int AS cuantos
FROM products WHERE active AND subcategory_id IS NULL AND subcategory IS NOT NULL
GROUP BY category_id, 2;

-- name: CategoriasOrdenadas :many
SELECT id, name FROM categories ORDER BY sort_order;

-- name: SlugOcupado :one
SELECT id FROM products WHERE slug = $1 LIMIT 1;

-- name: CrearProducto :one
INSERT INTO products (name, slug, category_id, subcategory, subcategory_id, description, brand, unit, forma_de_venta,
  precio_media_pct, alicuota_iva, imputacion, recargo_elaboracion_pct, featured, a_pedido, active)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
RETURNING id;

-- name: EditarProducto :exec
UPDATE products SET name = $2, slug = $3, category_id = $4, subcategory = $5, subcategory_id = $6, description = $7,
  brand = $8, unit = $9, forma_de_venta = $10, precio_media_pct = $11, alicuota_iva = $12, imputacion = $13,
  recargo_elaboracion_pct = $14, featured = $15, a_pedido = $16, active = $17, updated_at = now()
WHERE id = $1;

-- name: AgregarImagenInicial :exec
INSERT INTO product_images (product_id, url, alt) VALUES ($1, $2, $3);

-- name: IDsDeVariantes :many
SELECT id FROM product_variants WHERE product_id = $1;

-- name: DesactivarVariantes :exec
UPDATE product_variants SET active = false, updated_at = now() WHERE id = ANY(sqlc.arg(ids)::uuid[]);

-- name: CrearVariante :one
INSERT INTO product_variants (product_id, sku, label, largo_mm, ancho_mm, espesor_mm, material, color, terminacion,
  calidad, sort_order, active)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
RETURNING id;

-- name: EditarVariante :exec
UPDATE product_variants SET product_id = $2, sku = $3, label = $4, largo_mm = $5, ancho_mm = $6, espesor_mm = $7,
  material = $8, color = $9, terminacion = $10, calidad = $11, sort_order = $12, active = true, updated_at = now()
WHERE id = $1;

-- name: GuardarPrecio :exec
INSERT INTO price_list_items (price_list_id, variant_id, price, updated_at)
VALUES ($1, $2, sqlc.arg(price)::text::numeric, now())
ON CONFLICT (price_list_id, variant_id) DO UPDATE SET price = excluded.price, updated_at = now();

-- name: BloquearStock :exec
-- La misma clave que lib/inventario/locks.ts: hashtext(variantId || branchId).
SELECT pg_advisory_xact_lock(hashtext(sqlc.arg(variante)::text || sqlc.arg(sucursal)::text));

-- name: StockDe :one
SELECT qty FROM inventory WHERE variant_id = $1 AND branch_id = $2;

-- name: FijarStock :exec
INSERT INTO inventory (variant_id, branch_id, qty, min_qty, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (variant_id, branch_id) DO UPDATE SET qty = excluded.qty, min_qty = excluded.min_qty, updated_at = now();

-- name: RegistrarMovimiento :exec
INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id, transfer_group)
VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: CambiarActivo :one
UPDATE products SET active = $2, updated_at = now() WHERE id = $1 RETURNING name;

-- name: SiguienteOrdenDeImagen :one
SELECT (coalesce(max(sort_order), -1) + 1)::int FROM product_images WHERE product_id = $1;

-- name: CrearImagen :one
INSERT INTO product_images (product_id, url, sort_order) VALUES ($1, $2, $3) RETURNING id;

-- name: ImagenPorID :one
SELECT id, product_id, url FROM product_images WHERE id = $1;

-- name: BorrarImagenDeProducto :exec
DELETE FROM product_images WHERE id = $1;

-- name: OrdenarImagen :exec
UPDATE product_images SET sort_order = $3 WHERE id = $1 AND product_id = $2;

-- name: NombreDeProducto :one
SELECT name FROM products WHERE id = $1;

-- name: UltimoOrdenSugerido :one
SELECT coalesce(max(orden), -1)::int FROM related_products WHERE product_id = $1 AND tipo = $2;

-- name: AgregarSugerido :one
INSERT INTO related_products (product_id, related_product_id, tipo, orden) VALUES ($1, $2, $3, $4)
ON CONFLICT DO NOTHING RETURNING id;

-- name: QuitarSugerido :execrows
DELETE FROM related_products WHERE id = $1 AND product_id = $2;

-- name: SugeridosDelProducto :many
SELECT r.id, r.related_product_id, s.name AS nombre, c.name AS categoria, s.active AS activo, r.tipo, r.orden,
  coalesce((SELECT i.url FROM product_images i WHERE i.product_id = s.id ORDER BY i.sort_order LIMIT 1), '')::text AS imagen
FROM related_products r
JOIN products s ON s.id = r.related_product_id
LEFT JOIN categories c ON c.id = s.category_id
WHERE r.product_id = $1
ORDER BY r.tipo, r.orden;

-- name: CandidatosParaSugerir :many
SELECT p.id, p.name AS nombre, c.name AS categoria
FROM products p LEFT JOIN categories c ON c.id = p.category_id
WHERE p.active AND p.id <> $1
ORDER BY p.name;

-- name: RubroExiste :one
SELECT id FROM subcategories WHERE category_id = $1 AND slug = $2 LIMIT 1;

-- name: SiguienteOrdenDeRubro :one
SELECT (coalesce(max(sort_order), -1) + 1)::int FROM subcategories WHERE category_id = $1;

-- name: CrearRubro :one
INSERT INTO subcategories (category_id, slug, name, sort_order) VALUES ($1, $2, $3, $4) RETURNING id;

-- name: CambiarRubroActivo :one
UPDATE subcategories SET active = $2, updated_at = now() WHERE id = $1 RETURNING name;

-- name: RubroPorID :one
SELECT id, name, category_id FROM subcategories WHERE id = $1;

-- name: EngancharPorTexto :execrows
UPDATE products SET subcategory_id = sqlc.arg(rubro), updated_at = now()
WHERE category_id = sqlc.arg(categoria) AND subcategory_id IS NULL
  AND lower(unaccent(subcategory)) = lower(unaccent(sqlc.arg(nombre)::text));

-- name: CandidatosDeBaja :many
SELECT p.id, p.name AS nombre, p.slug, c.name AS categoria, p.created_at AS creado,
  (SELECT count(*) FROM product_variants v WHERE v.product_id = p.id AND v.active)::int AS variantes,
  coalesce((SELECT sum(greatest(i.qty - i.reservado, 0)) FROM inventory i
            JOIN product_variants pv ON pv.id = i.variant_id
            WHERE pv.product_id = p.id AND pv.active), 0)::float8 AS stock,
  (SELECT count(*) FROM product_variants pv WHERE pv.product_id = p.id AND pv.active
     AND NOT EXISTS (SELECT 1 FROM price_list_items pli WHERE pli.variant_id = pv.id AND pli.price > 0))::int AS variantes_sin_precio,
  (SELECT max(o.created_at) FROM order_items oi JOIN orders o ON o.id = oi.order_id
     JOIN product_variants pv ON pv.id = oi.variant_id WHERE pv.product_id = p.id)::timestamptz AS ultima_venta
FROM products p JOIN categories c ON c.id = p.category_id
WHERE p.active
ORDER BY p.name;

-- name: MesesSinVender :one
SELECT valor FROM site_settings WHERE clave = 'catalogo.meses_sin_vender_baja';

-- name: GuardarMesesSinVender :exec
INSERT INTO site_settings (clave, valor, descripcion)
VALUES ('catalogo.meses_sin_vender_baja', $1, 'Meses sin una sola venta para que un producto aparezca como candidato a dar de baja.')
ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor, updated_at = now();

-- name: ImputacionesUsadas :many
SELECT DISTINCT imputacion::text FROM products WHERE imputacion IS NOT NULL ORDER BY 1;
