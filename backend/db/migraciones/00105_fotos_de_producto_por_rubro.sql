-- Las fotos de producto que quedaron del sembrado eran de cualquier cosa: una
-- mujer con una laptop, un taladro y un living. Con la tienda apagada el
-- catálogo vive de las fotos, y un deck con una laptop le dice a quien no
-- sabe de maderas lo contrario de lo que es. Pasan a la portada de su rubro
-- (lib/db/portadas-datos.ts); las fotos reales que se suban no se tocan.

-- +goose Up
UPDATE product_images i
SET url = CASE c.slug
    WHEN 'techos' THEN '/fotos/photo-1776624383828-e1bf5d141aa7.jpg'
    WHEN 'placas' THEN '/fotos/photo-1700973408133-b45276ec8feb.jpg'
    WHEN 'pisos' THEN '/fotos/photo-1573869908170-64b53a60d8da.jpg'
    WHEN 'molduras' THEN '/fotos/photo-1764283824453-02cd00e49143.jpg'
    WHEN 'ferreteria' THEN '/fotos/photo-1558618666-fcd25c85cd64.jpg'
    WHEN 'decks-y-escaleras' THEN '/fotos/photo-1585597985125-9ad0229ae71d.jpg'
    WHEN 'construccion-en-seco' THEN '/fotos/photo-1768321903269-8a1f17a45c25.jpg'
    WHEN 'cubiertas' THEN '/fotos/photo-1632759145351-1d592919f522.jpg'
  END
FROM products p JOIN categories c ON c.id = p.category_id
WHERE p.id = i.product_id
  AND c.slug IN ('techos', 'placas', 'pisos', 'molduras', 'ferreteria', 'decks-y-escaleras', 'construccion-en-seco', 'cubiertas')
  AND i.url IN ('/fotos/photo-1520333789090-1afc82db536a.jpg', '/fotos/photo-1504148455328-c376907d081c.jpg', '/fotos/photo-1615873968403-89e068629265.jpg');

DELETE FROM product_images
WHERE url IN ('/fotos/photo-1520333789090-1afc82db536a.jpg', '/fotos/photo-1504148455328-c376907d081c.jpg', '/fotos/photo-1615873968403-89e068629265.jpg');

-- +goose Down
SELECT 1;
