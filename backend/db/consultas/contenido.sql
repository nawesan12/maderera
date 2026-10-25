-- El contenido del sitio (internal/contenido): lib/dal/contenido.ts,
-- banners.ts, resenas.ts, lib/dal/admin/contenido.ts y las acciones de
-- app/admin/contenido.

-- name: Ajustes :many
SELECT clave, valor, descripcion, updated_at FROM site_settings ORDER BY clave;

-- name: GuardarAjuste :execrows
UPDATE site_settings SET valor = $2, updated_at = now() WHERE clave = $1;

-- name: PromosVigentes :many
SELECT id, medio, titulo, detalle, dias, vigencia_hasta, quien_paga, imagen_url
FROM bank_promotions
WHERE activo AND (vigencia_hasta IS NULL OR vigencia_hasta >= now())
ORDER BY orden, created_at;

-- name: PromosTodas :many
SELECT * FROM bank_promotions ORDER BY orden, created_at DESC;

-- name: PromoPorID :one
SELECT * FROM bank_promotions WHERE id = $1;

-- name: CrearPromo :one
INSERT INTO bank_promotions (medio, titulo, detalle, dias, quien_paga, vigencia_hasta, orden, activo, imagen_url)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id;

-- name: EditarPromo :exec
UPDATE bank_promotions SET medio = $2, titulo = $3, detalle = $4, dias = $5, quien_paga = $6,
  vigencia_hasta = $7, orden = $8, activo = $9, imagen_url = $10, updated_at = now()
WHERE id = $1;

-- name: BorrarPromo :exec
DELETE FROM bank_promotions WHERE id = $1;

-- name: BannersPublicados :many
SELECT id, etiqueta, titulo, bajada, enlace, texto_enlace, imagen_url, updated_at
FROM banners
WHERE ubicacion = $1 AND activo
  AND (desde IS NULL OR desde <= now()) AND (hasta IS NULL OR hasta >= now())
ORDER BY orden, created_at;

-- name: BannersTodos :many
SELECT * FROM banners ORDER BY ubicacion, orden, created_at DESC;

-- name: BannerPorID :one
SELECT * FROM banners WHERE id = $1;

-- name: CrearBanner :one
INSERT INTO banners (ubicacion, etiqueta, titulo, bajada, enlace, texto_enlace, desde, hasta, orden, activo, imagen_url)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id;

-- name: EditarBanner :exec
UPDATE banners SET ubicacion = $2, etiqueta = $3, titulo = $4, bajada = $5, enlace = $6, texto_enlace = $7,
  desde = $8, hasta = $9, orden = $10, activo = $11, imagen_url = $12, updated_at = now()
WHERE id = $1;

-- name: BorrarBanner :exec
DELETE FROM banners WHERE id = $1;

-- name: ResenasPublicadas :many
SELECT id, nombre, estrellas, texto, created_at AS fecha
FROM product_reviews WHERE product_id = $1 AND estado = 'publicada'
ORDER BY created_at DESC LIMIT 50;

-- name: RepartoDeResenas :many
SELECT estrellas, count(*)::int AS cuantas
FROM product_reviews WHERE product_id = $1 AND estado = 'publicada'
GROUP BY estrellas;

-- name: ClienteDelUsuario :one
SELECT id, nombre FROM customers WHERE user_id = $1 AND active LIMIT 1;

-- name: ProductosResenables :many
SELECT p.id AS product_id, p.slug, p.name AS nombre, o.id AS order_id, o.numero AS numero_pedido,
       EXISTS (SELECT 1 FROM product_reviews r WHERE r.customer_id = $1 AND r.order_id = o.id AND r.product_id = p.id) AS ya_resenado
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN product_variants v ON v.id = oi.variant_id
JOIN products p ON p.id = v.product_id
WHERE o.customer_id = $1 AND o.estado = 'entregado' AND p.active
GROUP BY p.id, p.slug, p.name, o.id, o.numero
ORDER BY max(o.created_at) DESC
LIMIT 100;

-- name: PuedeResenar :one
SELECT EXISTS (
  SELECT 1 FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  JOIN product_variants v ON v.id = oi.variant_id
  WHERE o.id = $2 AND o.customer_id = $1 AND o.estado = 'entregado' AND v.product_id = $3
);

-- name: CrearResena :one
-- El índice único (order_id, product_id) frena la segunda reseña de la
-- misma compra, aunque lleguen dos a la vez.
INSERT INTO product_reviews (product_id, customer_id, order_id, estrellas, texto, nombre)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (order_id, product_id) DO NOTHING
RETURNING id;

-- name: SlugDeProducto :one
SELECT slug FROM products WHERE id = $1;

-- name: ResenasParaModerar :many
SELECT r.id, p.name AS producto, p.slug AS producto_slug, r.nombre, r.estrellas, r.texto, r.estado,
       r.motivo_rechazo, o.numero AS numero_pedido, r.created_at
FROM product_reviews r
JOIN products p ON p.id = r.product_id
JOIN orders o ON o.id = r.order_id
ORDER BY CASE WHEN r.estado = 'pendiente' THEN 0 ELSE 1 END, r.created_at DESC
LIMIT 200;

-- name: ModerarResena :one
UPDATE product_reviews SET estado = $2, motivo_rechazo = $3, resuelto_por = $4, updated_at = now()
WHERE id = $1 RETURNING product_id;
