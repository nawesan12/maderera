-- +goose Up
-- Las fotos de muestra dejan de venir de Unsplash: están en public/fotos/
-- con el identificador de Unsplash como nombre. La URL se reescribe a
-- /fotos/<identificador>.jpg; next.config.ts ya no admite hosts de afuera.
UPDATE banners SET imagen_url = regexp_replace(imagen_url,
	'^https://(images|plus)\.unsplash\.com/((premium_)?photo-[0-9a-f-]+).*$', '/fotos/\2.jpg')
	WHERE imagen_url ~ '^https://(images|plus)\.unsplash\.com/';
UPDATE categories SET image = regexp_replace(image,
	'^https://(images|plus)\.unsplash\.com/((premium_)?photo-[0-9a-f-]+).*$', '/fotos/\2.jpg')
	WHERE image ~ '^https://(images|plus)\.unsplash\.com/';
UPDATE product_images SET url = regexp_replace(url,
	'^https://(images|plus)\.unsplash\.com/((premium_)?photo-[0-9a-f-]+).*$', '/fotos/\2.jpg')
	WHERE url ~ '^https://(images|plus)\.unsplash\.com/';

-- +goose Down
-- Sin vuelta: las URLs de origen no se guardaron y las fotos ya están acá.
SELECT 1;
