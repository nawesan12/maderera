-- Documentos, lecturas de eventos, el sitemap y el contacto
-- (internal/contenido/sitio.go).

-- name: EsProfesionalAprobado :one
-- La verdad sobre si es profesional está en la ficha, no en la solicitud: un
-- vendedor puede marcarlo desde el mostrador sin formulario.
SELECT EXISTS (
  SELECT 1 FROM customers
  WHERE user_id = $1 AND active AND tipo = 'profesional' AND estado <> 'inactivo'
);

-- name: DocumentosVisibles :many
-- El permiso va dentro de la consulta: listar todo y filtrar en la pantalla
-- ya sería haber leído lo que no corresponde.
SELECT id, titulo, descripcion, categoria, url, formato, tamano_bytes, solo_profesionales
FROM technical_documents
WHERE activo AND (sqlc.arg(profesional)::boolean OR NOT solo_profesionales)
ORDER BY orden, titulo;

-- name: DocumentosReservados :one
SELECT count(*)::int FROM technical_documents WHERE activo AND solo_profesionales;

-- name: EventosProximos :many
SELECT e.id, e.slug, e.titulo, e.resumen, e.imagen_url, e.lugar, e.inicia, e.termina, e.cupo, e.precio,
       e.solo_profesionales,
       (SELECT count(*)::int FROM event_registrations er
        WHERE er.event_id = e.id AND er.estado IN ('reservada', 'confirmada', 'asistio')) AS inscriptos
FROM events e
WHERE e.estado = 'publicado' AND e.inicia >= now()
ORDER BY e.inicia;

-- name: EventoPorSlug :one
SELECT e.id, e.slug, e.titulo, e.resumen, e.descripcion, e.imagen_url, e.lugar, e.inicia, e.termina, e.cupo,
       e.precio, e.solo_profesionales, e.estado,
       (SELECT count(*)::int FROM event_registrations er
        WHERE er.event_id = e.id AND er.estado IN ('reservada', 'confirmada', 'asistio')) AS inscriptos
FROM events e WHERE e.slug = $1 LIMIT 1;

-- name: MiInscripcion :one
SELECT id, estado::text AS estado FROM event_registrations WHERE event_id = $1 AND user_id = $2 LIMIT 1;

-- name: EventoVisible :one
SELECT EXISTS (SELECT 1 FROM events WHERE slug = $1 AND estado <> 'borrador');

-- name: SlugsDeEventosVisibles :many
SELECT slug FROM events WHERE estado <> 'borrador' ORDER BY inicia DESC LIMIT $1;

-- name: SitemapCatalogo :many
SELECT p.slug,
  greatest(
    p.updated_at,
    coalesce((SELECT max(v.updated_at) FROM product_variants v WHERE v.product_id = p.id), p.updated_at),
    coalesce((
      SELECT max(pli.updated_at)
      FROM price_list_items pli
      JOIN product_variants v ON v.id = pli.variant_id
      WHERE v.product_id = p.id
    ), p.updated_at)
  )::timestamptz AS actualizada,
  coalesce((
    SELECT array_agg(i.url ORDER BY i.sort_order, i.created_at)
    FROM product_images i WHERE i.product_id = p.id
  ), '{}')::text[] AS imagenes
FROM products p
WHERE p.active
ORDER BY actualizada DESC;

-- name: SitemapCategorias :many
SELECT c.slug AS categoria, NULL::text AS rubro, max(p.updated_at)::timestamptz AS actualizada, coalesce(max(c.image), '')::text AS imagen
FROM categories c
JOIN products p ON p.category_id = c.id AND p.active
WHERE c.active
GROUP BY c.slug
UNION ALL
SELECT c.slug AS categoria, s.slug AS rubro, max(p.updated_at)::timestamptz AS actualizada, ''::text AS imagen
FROM subcategories s
JOIN categories c ON c.id = s.category_id AND c.active
JOIN products p ON p.subcategory_id = s.id AND p.active
WHERE s.active
GROUP BY c.slug, s.slug;

-- name: SitemapEventos :many
SELECT slug, updated_at AS actualizada, imagen_url FROM events WHERE estado = 'publicado' AND inicia >= now();

-- name: RegistrarConsultaWeb :exec
INSERT INTO notifications_log (canal, evento, destinatario, asunto, estado, proveedor_mensaje_id, error)
VALUES ('email', 'consulta_web', $1, $2, $3, $4, $5);

-- name: SucursalesActivas :many
-- Solo las filas: la ficha publicada (dirección, horario, teléfonos) es una
-- constante de lib/sucursales.ts, y Next la junta con esto.
SELECT id, slug, name AS nombre, sort_order FROM branches WHERE active ORDER BY sort_order;

-- name: ZonasDeEnvio :many
SELECT id, nombre, costo, envio_gratis_desde, demora_estimada, a_cotizar
FROM shipping_zones WHERE activa ORDER BY orden;

-- name: EscalasDePago :many
SELECT medio, desde_monto, porcentaje, etiqueta
FROM payment_discounts WHERE activo ORDER BY medio, desde_monto;

-- name: DocumentosDelPanel :many
SELECT id, titulo, descripcion, categoria, url, formato, tamano_bytes, solo_profesionales, activo, created_at
FROM technical_documents ORDER BY activo DESC, categoria, titulo;

-- name: CategoriasDeDocumentos :many
SELECT DISTINCT categoria FROM technical_documents WHERE activo ORDER BY categoria;

-- name: CrearDocumento :one
INSERT INTO technical_documents (titulo, descripcion, categoria, url, formato, tamano_bytes, solo_profesionales)
VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id;

-- name: DocumentoSoloProfesionales :execrows
UPDATE technical_documents SET solo_profesionales = $2, updated_at = now() WHERE id = $1;

-- name: DocumentoActivo :execrows
UPDATE technical_documents SET activo = $2, updated_at = now() WHERE id = $1;
