-- +goose Up
-- Ferretería y Cubiertas pierden su foto de banco (comité final, M18).
--
-- La de Ferretería era un taller cualquiera; la de Cubiertas, un techo de
-- tejas, que la casa no vende. Es la misma regla que la 00150 aplicó a los
-- productos: sin foto propia, la tarjeta dibuja la placa del rubro en su
-- tono de madera (components/catalogo/fondo-de-rubro.tsx) y no promete nada.
--
-- Solo se borra la portada si sigue siendo esa foto: si la clienta subió
-- otra, se deja. El Down vuelve a poner la de banco donde quedó vacía.
-- +goose StatementBegin
WITH sacadas AS (
  UPDATE categories SET image = NULL, updated_at = now()
  WHERE (slug = 'ferreteria' AND image = '/fotos/photo-1558618666-fcd25c85cd64.jpg')
     OR (slug = 'cubiertas' AND image = '/fotos/photo-1632759145351-1d592919f522.jpg')
  RETURNING slug
)
-- Las páginas cacheadas se enteran, como en la 00150. Solo si cambió algo:
-- una base vacía (las de prueba) no queda con un trabajo de más.
INSERT INTO trabajos (tipo, carga)
SELECT 'next.revalidar', '{"etiquetas":["catalogo"],"rutas":["/catalogo","/moldava","/"]}'::jsonb
WHERE EXISTS (SELECT 1 FROM sacadas);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
UPDATE categories SET image = CASE slug
    WHEN 'ferreteria' THEN '/fotos/photo-1558618666-fcd25c85cd64.jpg'
    WHEN 'cubiertas' THEN '/fotos/photo-1632759145351-1d592919f522.jpg' END,
  updated_at = now()
WHERE slug IN ('ferreteria', 'cubiertas') AND image IS NULL;
-- +goose StatementEnd
