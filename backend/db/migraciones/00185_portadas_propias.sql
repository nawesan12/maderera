-- +goose Up
-- Las portadas de rubro pasan a ser fotos propias (material del Drive de la
-- clienta, 19/11/2026; docs/fotos.md).
--
-- - Placas: tablero de pino en dos espesores, con los cantos a la vista.
-- - Ferretería: los accesorios de cortinería que la clienta marcó con 👆.
-- - Construcción en seco: OSB con el canto.
-- - Molduras queda sin foto: la tarjeta grande de Moldava ya muestra la
--   estantería, y con foto se leía como el mismo rubro dos veces.
--
-- Techos, pisos y decks siguen con las de banco hasta que haya fotos propias.
--
-- Solo se pisa una portada que todavía es de banco (/fotos/…) o está vacía:
-- la que subió la clienta se deja. Los nombres llevan versión (-v1): la caché
-- de imágenes de Next dura 30 días y sobrevive a los despliegues, así que un
-- recorte nuevo va con otro nombre.
-- +goose StatementBegin
WITH cambiadas AS (
  UPDATE categories c SET image = n.image, updated_at = now()
  FROM (VALUES
    ('placas', '/sitio/placas-v1.webp'),
    ('ferreteria', '/sitio/ferreteria-v1.webp'),
    ('construccion-en-seco', '/sitio/seco-v1.webp'),
    ('molduras', NULL)
  ) AS n(slug, image)
  WHERE c.slug = n.slug
    AND (c.image IS NULL OR c.image LIKE '/fotos/%')
    AND c.image IS DISTINCT FROM n.image
  RETURNING c.slug
)
INSERT INTO trabajos (tipo, carga)
SELECT 'next.revalidar', '{"etiquetas":["catalogo"],"rutas":["/catalogo","/moldava","/"]}'::jsonb
WHERE EXISTS (SELECT 1 FROM cambiadas);
-- +goose StatementEnd

-- +goose Down
-- Vuelven las de antes donde sigue la de esta migración.
-- +goose StatementBegin
UPDATE categories SET image = CASE slug
    WHEN 'placas' THEN '/fotos/photo-1700973408133-b45276ec8feb.jpg'
    WHEN 'construccion-en-seco' THEN '/fotos/photo-1768321903269-8a1f17a45c25.jpg'
    ELSE NULL END,
  updated_at = now()
WHERE (slug = 'placas' AND image = '/sitio/placas-v1.webp')
   OR (slug = 'ferreteria' AND image = '/sitio/ferreteria-v1.webp')
   OR (slug = 'construccion-en-seco' AND image = '/sitio/seco-v1.webp');
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE categories SET image = '/fotos/photo-1764283824453-02cd00e49143.jpg', updated_at = now()
WHERE slug = 'molduras' AND image IS NULL;
-- +goose StatementEnd
