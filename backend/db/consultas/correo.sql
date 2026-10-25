-- El correo (internal/correo) contra la base del ERP. Del ERP solo lee: la
-- ficha del remitente, sus pedidos, sus cheques. Lo que crea algo en el ERP
-- se hace abriendo la pantalla del panel precargada. Lo propio del correo
-- (asignaciones, notas, seguimientos, plantillas) va en tablas correo_*.

-- name: RolDeCasilla :one
-- El rol de staff de la persona dueña de la casilla (mismo correo en
-- "user"). Las fichas de clientes solo se muestran a admin y vendedor.
SELECT p.staff_role::text AS rol, u.id AS usuario, u.name AS nombre
FROM "user" u
JOIN profiles p ON p.user_id = u.id
WHERE lower(u.email) = lower(sqlc.arg(correo)::text)
  AND p.role = 'staff' AND p.staff_role IS NOT NULL
LIMIT 1;

-- name: ClientesEntreCorreos :many
-- De estos correos, cuáles son de una ficha activa.
SELECT DISTINCT lower(email)::text AS correo
FROM customers
WHERE active AND email IS NOT NULL AND lower(email) = ANY(sqlc.arg(correos)::text[]);

-- name: FichaPorCorreo :one
-- La ficha del remitente. El correo no es único en customers: si hay
-- varias, la que tiene cuenta en el sitio y después la más nueva. El saldo
-- es la suma de los movimientos (positivo = debe), igual que
-- saldoDeCliente en lib/dal/credito.ts.
SELECT c.id, c.nombre, c.razon_social, c.cuit, c.tipo::text AS tipo, c.estado::text AS estado,
  c.limite_credito, c.dias_credito, c.cuenta_bloqueada, c.motivo_bloqueo, c.telefono,
  (SELECT coalesce(sum(am.monto), 0) FROM account_movements am WHERE am.customer_id = c.id)::numeric AS saldo
FROM customers c
WHERE c.active AND lower(c.email) = lower(sqlc.arg(correo)::text)
ORDER BY (c.user_id IS NOT NULL) DESC, c.created_at DESC
LIMIT 1;

-- name: PedidosAbiertosDeCliente :many
-- Abiertos: los que no se entregaron ni se cancelaron, como en
-- lib/dal/cuenta.ts.
SELECT id, numero, estado::text AS estado, total, created_at
FROM orders
WHERE customer_id = $1 AND estado NOT IN ('entregado', 'cancelado')
ORDER BY created_at DESC
LIMIT 20;

-- name: UltimoPresupuestoDeCliente :one
-- El último presupuesto: primero uno enviado que el cliente todavía no
-- contestó (es el que hay que seguir), si no el más nuevo.
SELECT id, numero, estado::text AS estado, total, created_at, valido_hasta
FROM quotes
WHERE customer_id = $1
ORDER BY (estado = 'enviado') DESC, created_at DESC
LIMIT 1;

-- name: ChequesPorVencerDeCliente :many
-- Los cheques del cliente que todavía tenemos (informados o en cartera),
-- del que vence antes al que vence después.
SELECT id, numero, banco, fecha_pago, importe, estado::text AS estado
FROM cheques
WHERE customer_id = $1 AND sentido = 'recibido' AND estado IN ('informado', 'cartera')
ORDER BY fecha_pago
LIMIT 10;

-- name: BuscarClientesConCorreo :many
-- Para sugerir en «Para»: clientes activos con correo cuyo nombre, razón
-- social o correo tienen lo escrito.
SELECT id, nombre, lower(email)::text AS correo
FROM customers
WHERE active AND email IS NOT NULL AND email <> ''
  AND (nombre ILIKE '%' || sqlc.arg(texto)::text || '%'
    OR razon_social ILIKE '%' || sqlc.arg(texto)::text || '%'
    OR email ILIKE '%' || sqlc.arg(texto)::text || '%')
ORDER BY (nombre ILIKE sqlc.arg(texto)::text || '%') DESC, nombre
LIMIT 6;
