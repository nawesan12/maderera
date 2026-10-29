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
