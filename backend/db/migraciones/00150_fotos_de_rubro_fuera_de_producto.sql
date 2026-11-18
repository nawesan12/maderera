-- Las fotos de banco que hacían de foto de producto salen (hallazgo 25 del
-- comité, 18/11/2026).
--
-- La 00105 le puso a cada producto la portada de su rubro para tapar fotos
-- que eran de cualquier cosa. Quedó otra mentira, más chica: Melamina, MDF y
-- Fenólico con el mismo terciado curvado, la bisagra con un hombre en un
-- taller, el Curvin con un techo de tejas. Desde que la foto ocupa todo el
-- ancho del celular se nota más. Sin foto, la tarjeta dibuja una placa con
-- el rubro (components/catalogo/placa-de-producto.tsx), que no promete nada
-- que no sea cierto.
--
-- **Qué se borra.** Solo filas cuya URL es una foto de banco de public/fotos:
-- las 8 portadas de lib/db/portadas-datos.ts (tests/portadas-migracion.test.ts
-- vigila que estén todas), las 3 que la 00105 ya reemplazaba y la «madera» del
-- sembrado. Lo que sube la clienta va a /subidas/ y no se toca.
--
-- **El caso que no se puede distinguir.** El panel acepta pegar una dirección
-- de foto, así que alguien pudo haber escrito a mano una de estas rutas para
-- un producto. Antes de correrla en producción, contarlo:
--
--   SELECT p.name, i.url, i.created_at FROM product_images i
--   JOIN products p ON p.id = i.product_id
--   WHERE i.url LIKE '/fotos/%' ORDER BY i.created_at DESC;
--
-- Lo que tenga fecha posterior al 18/11/2026 (la 00105) no vino de la
-- migración y hay que preguntarlo. Igual, nada se pierde: las filas quedan en
-- product_images_rubro_00150 y el Down las devuelve.
--
-- **Lo que se ve no cambia solo.** Las páginas del catálogo están armadas de
-- antemano y cacheadas con la etiqueta «catalogo»: sin avisarle a Next,
-- seguirían mostrando la foto borrada hasta que venza la caché. Por eso la
-- migración deja en la cola el mismo aviso que encola Go cuando cambia algo
-- por su cuenta (internal/revalidar): el worker se lo manda a Next apenas
-- arranca. Solo si borró algo, así una base vacía (las de prueba) no queda
-- con un trabajo de más.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS product_images_rubro_00150 AS
SELECT * FROM product_images WHERE false;
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO product_images_rubro_00150
SELECT * FROM product_images
WHERE url IN (
  -- Las portadas de los rubros (lib/db/portadas-datos.ts).
  '/fotos/photo-1776624383828-e1bf5d141aa7.jpg',
  '/fotos/photo-1700973408133-b45276ec8feb.jpg',
  '/fotos/photo-1573869908170-64b53a60d8da.jpg',
  '/fotos/photo-1764283824453-02cd00e49143.jpg',
  '/fotos/photo-1558618666-fcd25c85cd64.jpg',
  '/fotos/photo-1585597985125-9ad0229ae71d.jpg',
  '/fotos/photo-1768321903269-8a1f17a45c25.jpg',
  '/fotos/photo-1632759145351-1d592919f522.jpg',
  -- Las que la 00105 reemplazaba (por si quedó alguna).
  '/fotos/photo-1520333789090-1afc82db536a.jpg',
  '/fotos/photo-1504148455328-c376907d081c.jpg',
  '/fotos/photo-1615873968403-89e068629265.jpg',
  -- La «madera» del sembrado (lib/db/seed.ts).
  '/fotos/photo-1422246654994-34520d5a0340.jpg'
);
-- +goose StatementEnd

-- +goose StatementBegin
DELETE FROM product_images WHERE id IN (SELECT id FROM product_images_rubro_00150);
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO trabajos (tipo, carga)
SELECT 'next.revalidar', '{"etiquetas":["catalogo"],"rutas":["/catalogo","/moldava","/"]}'::jsonb
WHERE EXISTS (SELECT 1 FROM product_images_rubro_00150);
-- +goose StatementEnd

-- +goose Down
-- Vuelven las mismas filas, con su id y su orden. Las que ya estén (porque se
-- volvieron a cargar a mano) no se duplican.
-- +goose StatementBegin
INSERT INTO product_images
SELECT r.* FROM product_images_rubro_00150 r
WHERE NOT EXISTS (SELECT 1 FROM product_images i WHERE i.id = r.id)
  AND EXISTS (SELECT 1 FROM products p WHERE p.id = r.product_id);
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE product_images_rubro_00150;
-- +goose StatementEnd
