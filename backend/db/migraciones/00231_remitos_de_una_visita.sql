-- +goose Up
-- Una visita, una firma (mes simulado, 26/11/2026). La obra que tiene acopio
-- en dos pedidos manda al albañil a buscar cosas de los dos: había que
-- cargar dos veces el nombre y el documento, generar dos remitos y hacerlo
-- firmar dos veces. Ahora el retiro arma un remito por pedido (cada pedido
-- sigue con su numeración y su saldo) y los que salieron en la misma visita
-- apuntan al primero: se firman todos juntos con su enlace.
ALTER TABLE deliveries ADD COLUMN visita_de uuid REFERENCES deliveries(id);
CREATE INDEX deliveries_visita_idx ON deliveries (visita_de) WHERE visita_de IS NOT NULL;

-- +goose Down
DROP INDEX deliveries_visita_idx;
ALTER TABLE deliveries DROP COLUMN visita_de;
