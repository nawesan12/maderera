-- +goose Up
-- Controles sobre la plata del personal (T3, 18/11/2026). Lo que el
-- mostrador hacía sin que nadie lo autorizara —vender bajo la lista, anular
-- una venta ajena o de otro día, reintentar un cobro— ahora pide el PIN de un
-- administrador o queda a la vista del dueño.

-- El PIN de cada administrador, hasheado igual que la clave (scrypt). No es
-- la clave: se teclea delante del mostrador y se cambia sin cerrar sesiones.
ALTER TABLE "user" ADD COLUMN pin_autorizacion text;

-- El precio de lista con que se vendió cada renglón, al lado del que se
-- cobró: sin él no hay forma de saber después cuánto se dejó de cobrar.
ALTER TABLE order_items ADD COLUMN precio_lista numeric(12,2);

-- Quién autorizó y cuánto. En columnas y no solo en la bitácora: «cuánto
-- autorizó cada admin este mes» es una suma, no recorrer JSON.
--   dejado_de_cobrar: lo que la venta quedó por debajo de la lista más el
--     descuento tipeado (la escala por medio de pago es regla del negocio y
--     no cuenta). Se guarda siempre, autorizada o no.
--   bajo_lista_sin_autorizar: una venta sin conexión que pasó el porcentaje
--     libre. Ya ocurrió y no se rechaza, pero se marca en rojo.
--   huella_mostrador: el contenido de la venta; la misma clave con otra
--     venta adentro no devuelve la vieja como si nada.
ALTER TABLE orders
  ADD COLUMN autorizado_por text REFERENCES "user"(id),
  ADD COLUMN dejado_de_cobrar numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN bajo_lista_sin_autorizar boolean NOT NULL DEFAULT false,
  ADD COLUMN huella_mostrador text,
  ADD COLUMN anulacion_autorizada_por text REFERENCES "user"(id),
  ADD COLUMN mercaderia_no_volvio boolean NOT NULL DEFAULT false;
CREATE INDEX orders_dejado_de_cobrar_idx ON orders (created_at) WHERE dejado_de_cobrar > 0;

-- La clave del recibo contra los reintentos, como la de la venta, y la
-- huella de lo que cobró.
ALTER TABLE receipts ADD COLUMN clave text, ADD COLUMN huella text;
CREATE UNIQUE INDEX receipts_clave_idx ON receipts (clave) WHERE clave IS NOT NULL;

-- El movimiento de la cola que llegó con el turno ya cerrado entra con la
-- hora en que llegó (y cuenta como tardío); la hora que declaró queda acá.
-- bajo_la_base: el retiro que dejó el cajón sin el cambio. No se rechaza
-- (la plata ya salió), se marca.
ALTER TABLE cash_movements
  ADD COLUMN declarado_at timestamptz,
  ADD COLUMN bajo_la_base boolean NOT NULL DEFAULT false;

INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('descuento_sin_autorizacion_pct', '5', 'Lo que se puede dejar de cobrar en una venta sin el PIN de un admin: 0, 5 o 10 (por ciento)')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave = 'descuento_sin_autorizacion_pct';
ALTER TABLE cash_movements DROP COLUMN bajo_la_base, DROP COLUMN declarado_at;
DROP INDEX receipts_clave_idx;
ALTER TABLE receipts DROP COLUMN huella, DROP COLUMN clave;
DROP INDEX orders_dejado_de_cobrar_idx;
ALTER TABLE orders
  DROP COLUMN mercaderia_no_volvio,
  DROP COLUMN anulacion_autorizada_por,
  DROP COLUMN huella_mostrador,
  DROP COLUMN bajo_lista_sin_autorizar,
  DROP COLUMN dejado_de_cobrar,
  DROP COLUMN autorizado_por;
ALTER TABLE order_items DROP COLUMN precio_lista;
ALTER TABLE "user" DROP COLUMN pin_autorizacion;
