-- +goose Up
-- Por qué se perdió un presupuesto (mes simulado): rechazar no pedía motivo
-- y no había cómo ver por qué se pierden las ventas. Texto corto, de una
-- lista que arma la pantalla (precio, se lo llevó otro, no contestó…).
ALTER TABLE "quotes" ADD COLUMN "motivo_rechazo" text;

-- +goose Down
ALTER TABLE "quotes" DROP COLUMN "motivo_rechazo";
