-- La cartera de clientes del panel (internal/clientes).

-- name: ClientePorCuit :one
SELECT id, nombre FROM customers WHERE active AND cuit = ANY(sqlc.arg(formas)::text[]) LIMIT 1;

-- name: CrearCliente :one
INSERT INTO customers (nombre, razon_social, cuit, condicion_iva, tipo, email, telefono, direccion, rubro, asesor,
  seller_id, limite_credito, price_list_id, notas)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, sqlc.arg(limite)::text::numeric, $12, $13)
RETURNING id;

-- name: EditarCliente :exec
UPDATE customers SET nombre = $2, razon_social = $3, cuit = $4, condicion_iva = $5, tipo = $6, email = $7,
  telefono = $8, direccion = $9, rubro = $10, asesor = $11, seller_id = $12, limite_credito = sqlc.arg(limite)::text::numeric,
  price_list_id = $13, notas = $14, updated_at = now()
WHERE id = $1;

-- name: MovimientoManual :exec
INSERT INTO account_movements (customer_id, tipo, monto, detalle, created_by_user_id)
VALUES ($1, $2, sqlc.arg(monto)::text::numeric, $3, $4);

-- name: UsuarioDeLaFicha :one
SELECT id, user_id FROM customers WHERE id = $1;

-- name: SoltarCuentaWeb :exec
UPDATE customers SET user_id = NULL, active = false, updated_at = now() WHERE id = $1;

-- name: AtarCuentaWeb :exec
UPDATE customers SET user_id = $2, updated_at = now() WHERE id = $1;

-- name: MudarPedidos :exec
UPDATE orders SET customer_id = sqlc.arg(destino) WHERE customer_id = sqlc.arg(origen);

-- name: MudarPresupuestos :exec
UPDATE quotes SET customer_id = sqlc.arg(destino) WHERE customer_id = sqlc.arg(origen);

-- name: MudarMovimientos :exec
UPDATE account_movements SET customer_id = sqlc.arg(destino) WHERE customer_id = sqlc.arg(origen);

-- name: MudarDirecciones :exec
UPDATE addresses SET customer_id = sqlc.arg(destino) WHERE customer_id = sqlc.arg(origen);

-- name: BloquearCuenta :one
UPDATE customers SET cuenta_bloqueada = $2, motivo_bloqueo = $3, updated_at = now() WHERE id = $1 RETURNING nombre;

-- name: CambiarPlazo :one
UPDATE customers SET dias_credito = $2, updated_at = now() WHERE id = $1 RETURNING nombre;

-- name: CrearVendedor :exec
INSERT INTO sellers (nombre, tipo) VALUES ($1, $2);

-- name: EditarVendedor :exec
UPDATE sellers SET nombre = $2, tipo = $3 WHERE id = $1;

-- name: VendedorPorID :one
SELECT activo, nombre FROM sellers WHERE id = $1;

-- name: AlternarVendedor :exec
UPDATE sellers SET activo = NOT activo WHERE id = $1;

-- name: CrearGestion :exec
INSERT INTO customer_follow_ups (customer_id, asunto, notas, proxima_accion_at, responsable_user_id, creado_por)
VALUES ($1, $2, $3, $4, $5, $5);

-- name: GestionPorID :one
SELECT customer_id, asunto, notas FROM customer_follow_ups WHERE id = $1;

-- name: MoverGestion :exec
UPDATE customer_follow_ups SET etapa = $2, notas = $3, proxima_accion_at = $4, cerrado_at = $5, updated_at = now()
WHERE id = $1;

-- name: ProximaAccionDeGestion :one
SELECT proxima_accion_at FROM customer_follow_ups WHERE id = $1;
