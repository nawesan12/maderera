-- +goose Up
-- El «Hasta» de un banner vale el día entero, como la vigencia de una
-- promoción bancaria (mes simulado, M2S2-027). Los guardados a la medianoche
-- de acá pasan a las 23:59:59 del mismo día.
UPDATE banners
SET hasta = hasta + interval '23 hours 59 minutes 59 seconds'
WHERE hasta IS NOT NULL
  AND (hasta AT TIME ZONE 'America/Argentina/Buenos_Aires')::time = '00:00:00';

-- +goose Down
UPDATE banners
SET hasta = hasta - interval '23 hours 59 minutes 59 seconds'
WHERE hasta IS NOT NULL
  AND (hasta AT TIME ZONE 'America/Argentina/Buenos_Aires')::time = '23:59:59';
