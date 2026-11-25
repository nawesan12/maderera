-- +goose NO TRANSACTION
-- +goose Up
-- La ficha se busca por correo, sin mayúsculas ni espacios, en la compra
-- (checkout.clientePorCorreo) y en el panel (pedidos.fichaConElCorreo, en
-- cada detalle de un pedido sin cliente). El único índice del correo era el
-- trigram de la búsqueda (00168), que no sirve para lower(trim(email)) = … (los correos que vengan del padrón de ISIS pueden traer espacios).
--
-- CONCURRENTLY y sin transacción, como la 00168: la tabla de clientes no se
-- frena mientras se arma. Si una corrida cortada lo deja inválido, se borra
-- primero y IF NOT EXISTS lo vuelve a armar.

-- +goose StatementBegin
DO $$
DECLARE
  roto regclass;
BEGIN
  FOR roto IN
    SELECT i.indexrelid::regclass FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE NOT i.indisvalid AND c.relname = 'customers_email_lower_idx'
  LOOP
    EXECUTE format('DROP INDEX %s', roto);
  END LOOP;
END $$;
-- +goose StatementEnd

CREATE INDEX CONCURRENTLY IF NOT EXISTS customers_email_lower_idx ON customers (lower(trim(email)));

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS customers_email_lower_idx;
