-- Los cobros: el recibo, sus partes, los cheques y el efectivo a la caja
-- (internal/cobros).

-- name: NombreDelCliente :one
SELECT nombre, razon_social FROM customers WHERE id = $1;

-- name: CrearRecibo :one
INSERT INTO receipts (numero, customer_id, recibido_de, branch_id, total, origen, concepto, created_by_user_id)
VALUES ($1, $2, $3, $4, sqlc.arg(total)::text::numeric, $5, $6, $7)
RETURNING id;

-- name: CrearParteDeRecibo :exec
INSERT INTO receipt_parts (receipt_id, medio, importe, cheque_id, payment_id, referencia, orden)
VALUES ($1, $2, sqlc.arg(importe)::text::numeric, $3, $4, $5, $6);

-- name: AsentarMovimiento :one
INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, receipt_id, cheque_id, created_by_user_id)
VALUES ($1, $2, sqlc.arg(monto)::text::numeric, $3, $4, $5, $6, $7)
RETURNING id;

-- name: AtarMovimientoAlRecibo :exec
UPDATE receipts SET account_movement_id = $2 WHERE id = $1;

-- name: ChequePorID :one
SELECT id, estado, importe FROM cheques WHERE id = $1;

-- name: ChequeACartera :exec
UPDATE cheques SET estado = 'cartera', receipt_id = $2, updated_at = now() WHERE id = $1;

-- name: ChequeRepetido :one
SELECT id FROM cheques
WHERE sentido = 'recibido' AND numero = $1 AND lower(coalesce(banco, '')) = lower(sqlc.arg(banco)::text)
  AND estado <> 'anulado' AND estado <> 'rechazado'
LIMIT 1;

-- name: CrearChequeRecibido :one
INSERT INTO cheques (sentido, tipo, numero, banco, librador, emision, fecha_pago, importe, estado, customer_id,
  circuito, receipt_id, order_payment_id, created_by_user_id)
VALUES ('recibido', $1, $2, $3, $4, $5, $6, sqlc.arg(importe)::text::numeric, 'cartera', $7, $8, $9, $10, $11)
RETURNING id;

-- name: CajasAbiertas :many
SELECT id, branch_id FROM cash_sessions WHERE estado = 'abierta';

-- name: EfectivoACaja :exec
INSERT INTO cash_movements (session_id, tipo, monto, motivo, creado_por)
VALUES ($1, 'ingreso', sqlc.arg(monto)::text::numeric, $2, $3);

-- name: BloquearRecibo :exec
SELECT pg_advisory_xact_lock(hashtext(sqlc.arg(recibo)::text));

-- name: ReciboPorID :one
SELECT id, numero, customer_id, total, estado FROM receipts WHERE id = $1;

-- name: ChequesDelRecibo :many
SELECT cheque_id FROM receipt_parts WHERE receipt_id = $1 AND cheque_id IS NOT NULL;

-- name: EstadoDeCheque :one
SELECT estado FROM cheques WHERE id = $1;

-- name: AnularCheque :exec
UPDATE cheques SET estado = 'anulado', updated_at = now() WHERE id = $1;

-- name: MarcarReciboAnulado :exec
UPDATE receipts SET estado = 'anulado', motivo_anulacion = $2, anulado_at = now(), anulado_por_user_id = $3,
  anulacion_movement_id = $4
WHERE id = $1;

-- name: PedidoParaCobrar :one
SELECT id, numero, total::float8 AS total, customer_id, branch_id FROM orders WHERE id = $1;

-- name: PedidoPagado :exec
UPDATE orders SET estado_pago = 'pagado', updated_at = now() WHERE id = $1;

-- name: BloquearCheque :exec
SELECT pg_advisory_xact_lock(hashtext(sqlc.arg(cheque)::text));

-- name: ChequeCompleto :one
SELECT * FROM cheques WHERE id = $1;

-- name: CambiarEstadoDelCheque :exec
UPDATE cheques SET estado = $2, motivo_rechazo = $3, updated_at = now() WHERE id = $1;

-- name: CargarCheque :exec
INSERT INTO cheques (sentido, tipo, numero, banco, librador, fecha_pago, importe, estado, customer_id, circuito, notas, created_by_user_id)
VALUES ($1, $2, $3, $4, $5, $6, sqlc.arg(importe)::text::numeric, $7, $8, $9, $10, $11);

-- name: ClienteParaCredito :one
SELECT limite_credito::float8 AS limite_credito, estado::text AS estado, dias_credito, cuenta_bloqueada, motivo_bloqueo
FROM customers WHERE id = $1;

-- name: MovimientosParaAging :many
SELECT monto::float8 AS monto, created_at FROM account_movements WHERE customer_id = $1;

-- name: SaldoDeCliente :one
SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE customer_id = $1;

-- name: LibroDelCliente :many
SELECT m.id, m.created_at, m.tipo::text AS tipo, m.monto::float8 AS monto, m.detalle, m.referencia,
  o.id AS pedido_id, r.id AS recibo_id, r.numero AS recibo_numero, r.estado AS recibo_estado
FROM account_movements m
LEFT JOIN orders o ON o.numero = m.referencia
LEFT JOIN receipts r ON r.id = m.receipt_id
WHERE m.customer_id = $1 AND (sqlc.narg(desde)::timestamptz IS NULL OR m.created_at >= sqlc.narg(desde))
ORDER BY m.created_at DESC
LIMIT $2;

-- name: ComprasDeContado :many
SELECT id, created_at, numero, total::float8 AS total, estado_pago::text AS estado_pago
FROM orders
WHERE customer_id = $1 AND (medio_pago IS NULL OR medio_pago <> 'cuenta_corriente') AND estado <> 'cancelado'
  AND (sqlc.narg(desde)::timestamptz IS NULL OR created_at >= sqlc.narg(desde))
ORDER BY created_at DESC
LIMIT $2;

-- name: PagosInformados :many
SELECT id, created_at, monto::float8 AS monto, estado::text AS estado, medio, motivo_rechazo
FROM payments
WHERE customer_id = $1 AND tipo = 'deuda' AND estado IN ('en_revision', 'rechazado')
  AND (sqlc.narg(desde)::timestamptz IS NULL OR created_at >= sqlc.narg(desde))
ORDER BY created_at DESC;

-- name: ChequesSueltos :many
SELECT id, updated_at, tipo::text AS tipo, numero, banco, importe::float8 AS importe, estado::text AS estado, fecha_pago, motivo_rechazo
FROM cheques
WHERE customer_id = $1 AND sentido = 'recibido'
  AND (estado = 'informado' OR (estado = 'rechazado' AND receipt_id IS NULL))
  AND (sqlc.narg(desde)::timestamptz IS NULL OR created_at >= sqlc.narg(desde))
ORDER BY fecha_pago;

-- name: PartesDeRecibos :many
SELECT p.receipt_id, p.medio::text AS medio, p.importe::float8 AS importe, c.banco, c.numero, c.tipo
FROM receipt_parts p LEFT JOIN cheques c ON c.id = p.cheque_id
WHERE p.receipt_id = ANY(sqlc.arg(recibos)::uuid[])
ORDER BY p.orden;
