-- +goose Up
-- La 00091 cambió las URLs de las fotos en la base, pero Next guarda el
-- catálogo y el contenido en su caché de datos, que sobrevive al despliegue,
-- y lo siguió sirviendo con las URLs de Unsplash. El aviso de siempre
-- (internal/revalidar): el worker se lo pasa a Next.
INSERT INTO trabajos (tipo, carga, proximo_intento_at)
VALUES ('next.revalidar', '{"etiquetas":["catalogo","contenido","eventos","sucursales","ajustes-del-sitio"]}', now());

-- +goose Down
SELECT 1;
