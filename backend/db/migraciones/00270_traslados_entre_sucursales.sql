-- +goose Up
-- El traslado entre sucursales como remito interno (mes simulado, H009 y
-- H112): un viaje del camión lleva varias medidas, sale de una sucursal y
-- queda «en camino» hasta que quien recibe lo confirma. La salida baja el
-- stock del origen en el momento; la entrada sube el destino recién al
-- recibir. Los movimientos de los dos lados llevan el id del traslado en
-- transfer_group, como las transferencias de siempre.
--
-- El número es interno, no fiscal: una identidad alcanza (un hueco no le
-- importa a nadie, y no hace falta el candado de la numeración).
-- +goose StatementBegin
CREATE TABLE stock_traslados (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	numero integer GENERATED ALWAYS AS IDENTITY UNIQUE,
	origen_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
	destino_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
	nota text,
	estado text NOT NULL DEFAULT 'en-camino' CHECK (estado IN ('en-camino', 'recibido')),
	created_by_user_id text,
	created_at timestamptz NOT NULL DEFAULT now(),
	recibido_por_user_id text,
	recibido_at timestamptz,
	CHECK (origen_id <> destino_id)
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE stock_traslado_items (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	traslado_id uuid NOT NULL REFERENCES stock_traslados(id) ON DELETE CASCADE,
	variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
	cantidad numeric(12, 3) NOT NULL CHECK (cantidad > 0),
	orden integer NOT NULL DEFAULT 0
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX stock_traslados_en_camino_idx ON stock_traslados (destino_id) WHERE estado = 'en-camino';
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX stock_traslado_items_traslado_idx ON stock_traslado_items (traslado_id);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX stock_traslado_items_variante_idx ON stock_traslado_items (variant_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE stock_traslado_items;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE stock_traslados;
-- +goose StatementEnd
