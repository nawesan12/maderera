-- +goose Up
-- Recorrido M4-011 y M4-057: dos avisos viejos apuntaban a fotos de muestra
-- que se sacaron de public/fotos (5c6cbdb1) y cada visita a Avisos pedía
-- dos 404. Sin la imagen, el editor muestra el lugar vacío para elegir otra.
UPDATE banners SET imagen_url = NULL WHERE imagen_url IN (
	'/fotos/photo-1504307651254-35680f356dfd.jpg',
	'/fotos/photo-1571062618385-7cf10f16a2f4.jpg',
	'/fotos/photo-1631396328075-9c65a7406f09.jpg',
	'/fotos/photo-1634672652995-ee7525bce595.jpg',
	'/fotos/photo-1773430272778-28c224216811.jpg',
	'/fotos/premium_photo-1663133630972-d9b620dfea27.jpg');
UPDATE categories SET image = NULL WHERE image IN (
	'/fotos/photo-1504307651254-35680f356dfd.jpg',
	'/fotos/photo-1571062618385-7cf10f16a2f4.jpg',
	'/fotos/photo-1631396328075-9c65a7406f09.jpg',
	'/fotos/photo-1634672652995-ee7525bce595.jpg',
	'/fotos/photo-1773430272778-28c224216811.jpg',
	'/fotos/premium_photo-1663133630972-d9b620dfea27.jpg');

-- +goose Down
-- Sin vuelta: las fotos ya no están.
SELECT 1;
