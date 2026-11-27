-- +goose Up
-- Dos «textos del sitio» que se guardaban y no se leían en ningún lado (mes
-- simulado, M2S1-042): la franja de arriba de todo, que pasó a ser el aviso de
-- bienvenida (un banner que se abre como diálogo), y la leyenda de envío
-- gratis, que decía «a partir de $200.000» cuando cada zona de envío tiene su
-- propio mínimo.
DELETE FROM site_settings WHERE clave IN ('aviso_barra_superior', 'envio_gratis_leyenda');

-- +goose Down
INSERT INTO site_settings (clave, valor, descripcion) VALUES
	('aviso_barra_superior', '', 'Texto de la franja de arriba de todo. Vacío la oculta.'),
	('envio_gratis_leyenda', 'Envío sin cargo en Mar del Plata a partir de $200.000', 'Leyenda de la franja de confianza del catálogo.')
ON CONFLICT (clave) DO NOTHING;
