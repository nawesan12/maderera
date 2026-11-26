-- +goose Up
-- Lo que el mes simulado le pidió a la cola del taller.
--
-- terminado_at: cuándo salió de la máquina. La tarjeta de «Terminados» decía
-- «hace 32 min» contando desde el alta, y la columna iba del más viejo al
-- más nuevo: lo recién cortado quedaba último. Lo de antes no se sabe; queda
-- en nulo y la pantalla usa la última modificación.
--
-- sin_cargo: una reposición (la pieza que faltó en una entrega) se corta y
-- se entrega sin cobrar, atada al pedido que la originó. Hasta acá salía
-- como un corte suelto más, con sus pasadas «a cobrar».
--
-- motivo_anulado: un corte cargado mal no se podía anular ni corregir; el
-- malo seguía primero en la cola. El estado `cancelado` ya existía (lo usa
-- la venta anulada); esto dice por qué, y qué corte lo reemplaza.
ALTER TABLE cutting_orders ADD COLUMN terminado_at timestamp with time zone;
ALTER TABLE cutting_orders ADD COLUMN sin_cargo boolean NOT NULL DEFAULT false;
ALTER TABLE cutting_orders ADD COLUMN motivo_anulado text;

-- +goose Down
ALTER TABLE cutting_orders DROP COLUMN motivo_anulado;
ALTER TABLE cutting_orders DROP COLUMN sin_cargo;
ALTER TABLE cutting_orders DROP COLUMN terminado_at;
