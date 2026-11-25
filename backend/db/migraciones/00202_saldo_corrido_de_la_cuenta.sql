-- +goose Up
-- El saldo corrido de cada cuenta corriente, guardado en la ficha, para que
-- el trigger de la 00201 no recorra la cuenta entera en cada movimiento.
--
-- La 00201 buscaba el último cero mirando lo posterior al cero guardado. En
-- una cuenta que nunca llegó a cero —la constructora que compra todas las
-- semanas y paga a cuenta sin cancelar nunca— eso es la cuenta entera, con
-- la ficha bloqueada: 15 a 17 ms con 2.000 movimientos y 48 a 58 ms con
-- 20.000, en cada venta y en cada cobro, y cada vez más.
--
-- Ahora la ficha guarda además el saldo y el último movimiento (en el orden
-- de la cuenta, created_at e id). Un movimiento nuevo que entra al final —lo
-- normal— parte de ese saldo y recorre solo lo nuevo: cuesta lo mismo con
-- diez movimientos que con veinte mil. Lo demás queda como estaba:
--
-- - un alta con fecha anterior al último movimiento, una baja o un cambio
--   de monto, fecha o cliente después del cero: se recorre desde el cero
--   (ahí el saldo es cero por definición);
-- - lo mismo antes del cero, o sin cero: la cuenta entera.
--
-- El candado sobre la ficha y el orden por id de cliente son los de la 00201.
-- customers.updated_at sigue sin tocarse.
-- +goose StatementBegin
ALTER TABLE customers
  ADD COLUMN cuenta_saldo numeric NOT NULL DEFAULT 0,
  ADD COLUMN cuenta_ultimo_at timestamp with time zone,
  ADD COLUMN cuenta_ultimo_id uuid;
-- +goose StatementEnd

-- `alta` dice si el cambio son solo filas nuevas (INSERT): es el único caso
-- en que se puede partir del saldo guardado, porque nada de lo anterior se
-- movió.
-- +goose StatementBegin
CREATE FUNCTION mjbj_cuenta_al_dia(cliente uuid, desde_at timestamptz, desde_id uuid, alta boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  cero_at timestamptz;
  cero_id uuid;
  saldo numeric;
  ultimo_at timestamptz;
  ultimo_id uuid;
  base_at timestamptz;
  base_id uuid;
  base_saldo numeric;
  r record;
BEGIN
  SELECT cuenta_en_cero_at, cuenta_en_cero_id, cuenta_saldo, cuenta_ultimo_at, cuenta_ultimo_id
    INTO cero_at, cero_id, saldo, ultimo_at, ultimo_id
    FROM customers WHERE id = cliente FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN; -- la ficha se está borrando
  END IF;

  IF alta AND (ultimo_id IS NULL OR (desde_at, desde_id) > (ultimo_at, ultimo_id)) THEN
    -- Todo lo nuevo va después del último: se parte del saldo guardado.
    base_at := ultimo_at;
    base_id := ultimo_id;
    base_saldo := saldo;
  ELSIF cero_id IS NOT NULL AND (desde_at, desde_id) > (cero_at, cero_id) THEN
    -- Lo que cambió está después del cero: hasta ahí el saldo es cero.
    base_at := cero_at;
    base_id := cero_id;
    base_saldo := 0;
  ELSE
    base_at := NULL;
    base_id := NULL;
    base_saldo := 0;
    cero_at := NULL;
    cero_id := NULL;
  END IF;

  -- Lo posterior a la base, de una pasada: el último cero, el saldo al
  -- final y el último movimiento. Si no hay nada, el último es la base.
  saldo := base_saldo;
  ultimo_at := base_at;
  ultimo_id := base_id;
  FOR r IN
    SELECT m.created_at, m.id, base_saldo + sum(m.monto) OVER (ORDER BY m.created_at, m.id) AS acumulado
    FROM account_movements m
    WHERE m.customer_id = cliente
      AND (m.created_at, m.id) > (coalesce(base_at, '-infinity'), coalesce(base_id, '00000000-0000-0000-0000-000000000000'))
    ORDER BY m.created_at, m.id
  LOOP
    IF r.acumulado = 0 THEN
      cero_at := r.created_at;
      cero_id := r.id;
    END IF;
    saldo := r.acumulado;
    ultimo_at := r.created_at;
    ultimo_id := r.id;
  END LOOP;

  UPDATE customers SET cuenta_en_cero_at = cero_at, cuenta_en_cero_id = cero_id,
                       cuenta_saldo = saldo, cuenta_ultimo_at = ultimo_at, cuenta_ultimo_id = ultimo_id
  WHERE id = cliente
    AND (cuenta_en_cero_at, cuenta_en_cero_id, cuenta_saldo, cuenta_ultimo_at, cuenta_ultimo_id)
        IS DISTINCT FROM (cero_at, cero_id, saldo, ultimo_at, ultimo_id);
END $$;
-- +goose StatementEnd

-- El mismo trigger de la 00201, con la nueva función.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION mjbj_cuenta_en_cero() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR t IN SELECT DISTINCT ON (customer_id) customer_id, created_at, id FROM mjbj_cuenta_nuevos
             ORDER BY customer_id, created_at, id LOOP
      PERFORM mjbj_cuenta_al_dia(t.customer_id, t.created_at, t.id, true);
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR t IN SELECT DISTINCT ON (customer_id) customer_id, created_at, id FROM mjbj_cuenta_viejos
             ORDER BY customer_id, created_at, id LOOP
      PERFORM mjbj_cuenta_al_dia(t.customer_id, t.created_at, t.id, false);
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
      PERFORM mjbj_cuenta_al_dia(t.customer_id, t.created_at, t.id, false);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
-- +goose StatementEnd

-- +goose StatementBegin
DROP FUNCTION mjbj_cuenta_en_cero_cliente(uuid, timestamptz, uuid);
-- +goose StatementEnd

-- Lo de hoy, de una vez, en la misma transacción que el trigger nuevo.
-- +goose StatementBegin
UPDATE customers c SET cuenta_saldo = z.saldo, cuenta_ultimo_at = z.created_at, cuenta_ultimo_id = z.id
FROM (
  SELECT DISTINCT ON (customer_id) customer_id, created_at, id,
         sum(monto) OVER (PARTITION BY customer_id) AS saldo
  FROM account_movements
  ORDER BY customer_id, created_at DESC, id DESC
) z
WHERE z.customer_id = c.id;
-- +goose StatementEnd

-- +goose Down
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
    RETURN;
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
CREATE OR REPLACE FUNCTION mjbj_cuenta_en_cero() RETURNS trigger LANGUAGE plpgsql AS $$
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
-- +goose StatementBegin
DROP FUNCTION mjbj_cuenta_al_dia(uuid, timestamptz, uuid, boolean);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE customers DROP COLUMN cuenta_ultimo_id, DROP COLUMN cuenta_ultimo_at, DROP COLUMN cuenta_saldo;
-- +goose StatementEnd
