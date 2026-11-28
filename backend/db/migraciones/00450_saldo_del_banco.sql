-- +goose Up
-- El saldo del banco (mes simulado, M2S1-027 y M2S2-100). La maderera no
-- cargaba ninguno: «Plata hoy» sumaba al efectivo y a los cheques lo que se
-- había movido hoy en el banco, y el primer día, con un pago a un proveedor
-- por transferencia, el total daba −$ 5.303.360. Se carga lo que dice el
-- banco en un momento (`al`) y desde ahí se le suman las entradas y se le
-- restan las salidas que el sistema ve. Se guarda cada carga: la última
-- manda y las anteriores quedan de constancia.
CREATE TABLE saldos_de_banco (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	monto numeric(14, 2) NOT NULL,
	al timestamptz NOT NULL DEFAULT now(),
	created_by_user_id text REFERENCES "user" (id),
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saldos_de_banco_al_idx ON saldos_de_banco (al DESC);

-- +goose Down
DROP TABLE saldos_de_banco;
