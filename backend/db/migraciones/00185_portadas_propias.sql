-- +goose Up
-- Las portadas de rubro pasan a ser fotos propias (material del Drive de la
-- clienta, 19/11/2026; docs/fotos.md).
--
-- - Placas: tablero de pino en dos espesores, con los cantos a la vista.
-- - Ferretería: los accesorios de cortinería que la clienta marcó con 👆.
-- - Construcción en seco: OSB con el canto.
-- - Molduras: un zócalo Moldava de punta, sobre blanco. No la estantería: la
--   tarjeta grande de Moldava, al lado, ya la muestra.
--
-- Techos, pisos y decks siguen con las de banco hasta que haya fotos propias.
--
-- Solo se pisa una portada que todavía es de banco (/fotos/…), y la de
-- ferretería vacía, que es como la dejó la 00180. Otra vacía puede ser una
-- que la clienta sacó a propósito, y la que subió ella se deja. Los nombres
-- llevan versión (-v1): la caché de imágenes de Next dura 30 días y
-- sobrevive a los despliegues, así que un recorte nuevo va con otro nombre.
--
-- Sin aviso a Next: `desplegar.sh` migra antes de construir la aplicación, y
-- las fotos de /sitio/ llegan recién con la nueva. El aviso lo consumía la
-- versión anterior, que volvía a armar la portada con fotos que todavía no
-- tiene. La nueva arranca con la caché vacía (el CMD del Dockerfile), así que
-- no hace falta.
-- +goose StatementBegin
UPDATE categories c SET image = n.image, updated_at = now()
FROM (VALUES
  ('placas', '/sitio/placas-v1.webp'),
  ('ferreteria', '/sitio/ferreteria-v1.webp'),
  ('construccion-en-seco', '/sitio/seco-v1.webp'),
  ('molduras', '/sitio/molduras-v1.webp')
) AS n(slug, image)
WHERE c.slug = n.slug
  AND (c.image LIKE '/fotos/%' OR (c.image IS NULL AND c.slug = 'ferreteria'));
-- +goose StatementEnd

-- +goose Down
-- Vuelven las de antes donde sigue la de esta migración.
-- +goose StatementBegin
UPDATE categories SET image = CASE slug
    WHEN 'placas' THEN '/fotos/photo-1700973408133-b45276ec8feb.jpg'
    WHEN 'construccion-en-seco' THEN '/fotos/photo-1768321903269-8a1f17a45c25.jpg'
    WHEN 'molduras' THEN '/fotos/photo-1764283824453-02cd00e49143.jpg'
    ELSE NULL END,
  updated_at = now()
WHERE (slug = 'placas' AND image = '/sitio/placas-v1.webp')
   OR (slug = 'ferreteria' AND image = '/sitio/ferreteria-v1.webp')
   OR (slug = 'construccion-en-seco' AND image = '/sitio/seco-v1.webp')
   OR (slug = 'molduras' AND image = '/sitio/molduras-v1.webp');
-- +goose StatementEnd
