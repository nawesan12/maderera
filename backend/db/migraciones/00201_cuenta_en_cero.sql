-- +goose Up
-- Desde cuándo debe cada cliente, guardado en la ficha (T8, «Pendiente de la
-- cartera»).
--
-- La cartera calcula el aging de todos los deudores en cada carga, porque el
-- orden por urgencia sale de ahí. Lo de antes del último saldo exactamente
-- cero no cambia el aging (cada pago ya canceló sus deudas y no queda nada a
-- favor), pero para encontrar ese cero la consulta leía la cuenta entera de
-- cada deudor con una ventana. Ahora el cero está en `customers`: el último
-- movimiento, en el orden de la cuenta (created_at, id), en el que el saldo
-- corrido quedó en cero. La cartera lee solo lo posterior con el índice
-- (customer_id, created_at, id) de la 00168.
--
-- **Trigger y no llamadas en el código**, como los de la 00075 y la 00169:
-- a la cuenta corriente escriben el recibo, la venta, la anulación, la nota
-- de crédito, la baja de una factura, el ajuste, la unión de dos fichas y la
-- migración de ISIS. Con el cálculo en la tabla, ninguno —tampoco uno
-- nuevo— lo deja viejo.
--
-- **Lo que cuesta cada escritura.** Lo normal es un movimiento nuevo al
-- final de la cuenta: el saldo hasta el cero guardado es cero por
-- definición, así que alcanza con recorrer lo posterior (lo mismo que lee la
-- cartera) y buscar ahí el último cero. Solo si se toca algo de antes del
-- cero —un movimiento con fecha vieja, uno que se borra o se cambia, la
-- unión de fichas— se recorre la cuenta entera de ese cliente.
--
-- **Dos movimientos del mismo cliente a la vez.** Cada uno toma la fila del
-- cliente (FOR NO KEY UPDATE, que no choca con la clave foránea de
-- account_movements) antes de mirar la cuenta: el segundo espera al primero
-- y, en READ COMMITTED, la sentencia siguiente ya ve lo que el primero
-- escribió. Sin ese candado, dos cobros simultáneos podían dejar un cero
-- que no existe y la cartera perdía una deuda. Los clientes se toman en
-- orden de id, así dos sentencias de varios clientes no se abrazan.
--
-- **La fecha del cliente no cambia**: no se toca customers.updated_at, que
-- es lo que mira la copia del padrón del mostrador.
-- +goose StatementBegin
ALTER TABLE customers ADD COLUMN cuenta_en_cero_at timestamp with time zone, ADD COLUMN cuenta_en_cero_id uuid;
-- +goose StatementEnd

-- mjbj_cuenta_en_cero_cliente recalcula el cero de un cliente. `desde_at` y
-- `desde_id` son el primer movimiento que cambió: si está después del cero
-- guardado, se busca solo en lo posterior; si no, en toda la cuenta.
-- +goose StatementBegin
CREATE FUNCTION mjbj_cuenta_en_cero_cliente(cliente uuid, desde_at timestamptz, desde_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  cero_at timestamptz;
  cero_id uuid;
  nuevo_at timestamptz;
  nuevo_id uuid;
BEGIN
  SELECT cuenta_en_cero_at, cuenta_en_cero_id INTO cero_at, cero_id FROM customers WHERE id = cliente FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN; -- la ficha se está borrando
  END IF;
  IF cero_id IS NULL OR (desde_at, desde_id) <= (cero_at, cero_id) THEN
    cero_at := NULL;
    cero_id := NULL;
  END IF;
  SELECT x.created_at, x.id INTO nuevo_at, nuevo_id FROM (
    SELECT m.created_at, m.id, sum(m.monto) OVER (ORDER BY m.created_at, m.id) AS acumulado
    FROM account_movements m
    WHERE m.customer_id = cliente
      AND (m.created_at, m.id) > (coalesce(cero_at, '-infinity'), coalesce(cero_id, '00000000-0000-0000-0000-000000000000'))
  ) x
  WHERE x.acumulado = 0
  ORDER BY x.created_at DESC, x.id DESC
  LIMIT 1;
  IF FOUND THEN
    cero_at := nuevo_at;
    cero_id := nuevo_id;
  END IF;
  UPDATE customers SET cuenta_en_cero_at = cero_at, cuenta_en_cero_id = cero_id
  WHERE id = cliente AND (cuenta_en_cero_at, cuenta_en_cero_id) IS DISTINCT FROM (cero_at, cero_id);
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION mjbj_cuenta_en_cero() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR t IN SELECT DISTINCT ON (customer_id) customer_id, created_at, id FROM mjbj_cuenta_nuevos
             ORDER BY customer_id, created_at, id LOOP
      PERFORM mjbj_cuenta_en_cero_cliente(t.customer_id, t.created_at, t.id);
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR t IN SELECT DISTINCT ON (customer_id) customer_id, created_at, id FROM mjbj_cuenta_viejos
             ORDER BY customer_id, created_at, id LOOP
      PERFORM mjbj_cuenta_en_cero_cliente(t.customer_id, t.created_at, t.id);
    END LOOP;
  ELSE
    -- Solo lo que mueve el saldo o el orden: cambiar el detalle o la
    -- referencia (la baja de una factura lo hace) no recalcula nada. De un
    -- movimiento que cambia, cuentan la posición vieja y la nueva.
    FOR t IN SELECT DISTINCT ON (customer_id) customer_id, created_at, id FROM (
               SELECT a.customer_id, a.created_at, a.id FROM mjbj_cuenta_viejos a JOIN mjbj_cuenta_nuevos d ON d.id = a.id
               WHERE (d.customer_id, d.created_at, d.monto) IS DISTINCT FROM (a.customer_id, a.created_at, a.monto)
               UNION ALL
               SELECT d.customer_id, d.created_at, d.id FROM mjbj_cuenta_viejos a JOIN mjbj_cuenta_nuevos d ON d.id = a.id
               WHERE (d.customer_id, d.created_at, d.monto) IS DISTINCT FROM (a.customer_id, a.created_at, a.monto)
             ) x ORDER BY customer_id, created_at, id LOOP
      PERFORM mjbj_cuenta_en_cero_cliente(t.customer_id, t.created_at, t.id);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
-- +goose StatementEnd

-- Tres triggers y no uno: Postgres no deja usar tablas de transición en un
-- trigger de más de un evento (ni con lista de columnas).
-- +goose StatementBegin
CREATE TRIGGER mjbj_cuenta_en_cero_alta AFTER INSERT ON account_movements
  REFERENCING NEW TABLE AS mjbj_cuenta_nuevos FOR EACH STATEMENT EXECUTE FUNCTION mjbj_cuenta_en_cero();
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER mjbj_cuenta_en_cero_baja AFTER DELETE ON account_movements
  REFERENCING OLD TABLE AS mjbj_cuenta_viejos FOR EACH STATEMENT EXECUTE FUNCTION mjbj_cuenta_en_cero();
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TRIGGER mjbj_cuenta_en_cero_cambio AFTER UPDATE ON account_movements
  REFERENCING OLD TABLE AS mjbj_cuenta_viejos NEW TABLE AS mjbj_cuenta_nuevos FOR EACH STATEMENT EXECUTE FUNCTION mjbj_cuenta_en_cero();
-- +goose StatementEnd

-- Lo de hoy, de una vez. Va después de los triggers y en la misma
-- transacción: lo que se escriba mientras tanto espera a que termine.
-- +goose StatementBegin
UPDATE customers c SET cuenta_en_cero_at = z.created_at, cuenta_en_cero_id = z.id
FROM (
  SELECT DISTINCT ON (customer_id) customer_id, created_at, id FROM (
    SELECT customer_id, created_at, id, sum(monto) OVER (PARTITION BY customer_id ORDER BY created_at, id) AS acumulado
    FROM account_movements
  ) m
  WHERE acumulado = 0
  ORDER BY customer_id, created_at DESC, id DESC
) z
WHERE z.customer_id = c.id;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TRIGGER mjbj_cuenta_en_cero_cambio ON account_movements;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TRIGGER mjbj_cuenta_en_cero_baja ON account_movements;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TRIGGER mjbj_cuenta_en_cero_alta ON account_movements;
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION mjbj_cuenta_en_cero();
-- +goose StatementEnd
-- +goose StatementBegin
DROP FUNCTION mjbj_cuenta_en_cero_cliente(uuid, timestamptz, uuid);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE customers DROP COLUMN cuenta_en_cero_id, DROP COLUMN cuenta_en_cero_at;
-- +goose StatementEnd
