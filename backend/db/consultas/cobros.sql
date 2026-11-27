-- Los cobros: el recibo, sus partes, los cheques y el efectivo a la caja
-- (internal/cobros).

-- name: NombreDelCliente :one
SELECT nombre, razon_social FROM customers WHERE id = $1;

-- name: CrearRecibo :one
INSERT INTO receipts (numero, customer_id, recibido_de, branch_id, total, origen, concepto, created_by_user_id, order_id, clave, huella)
VALUES ($1, $2, $3, $4, sqlc.arg(total)::text::numeric, $5, $6, $7, $8, $9, $10)
RETURNING id;

-- name: ReciboPorClave :one
SELECT id, numero, total::float8 AS total, coalesce(huella, '') AS huella, account_movement_id
FROM receipts WHERE clave = $1;

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
SELECT id, estado, importe, customer_id, receipt_id, order_payment_id FROM cheques WHERE id = $1 FOR UPDATE;

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

-- name: TurnoParaElEfectivo :one
-- El candado compartido frena el cierre del turno hasta que el cobro
-- confirme, y el estado se lee después de esperarlo.
SELECT estado::text FROM cash_sessions WHERE id = $1 FOR SHARE;

-- name: EfectivoACaja :exec
INSERT INTO cash_movements (session_id, tipo, monto, motivo, creado_por)
VALUES ($1, 'ingreso', sqlc.arg(monto)::text::numeric, $2, $3);

-- name: BloquearRecibo :exec
SELECT pg_advisory_xact_lock(hashtext(sqlc.arg(recibo)::text));

-- name: ReciboPorID :one
SELECT id, numero, customer_id, total, estado, account_movement_id FROM receipts WHERE id = $1;

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
-- El pedido partido (a_cuenta) con el resto cobrado queda «parcial», como la
-- venta del mostrador que cargó una parte a la cuenta: lo que falta está en
-- la cuenta corriente.
UPDATE orders SET estado_pago = CASE WHEN a_cuenta IS NOT NULL THEN 'parcial'::estado_pago ELSE 'pagado'::estado_pago END,
  updated_at = now() WHERE id = $1;

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
-- El recibo, si la compra se cobró después con uno (una transferencia
-- conciliada): no fue «pagada en el momento» (H305). Del pedido partido
-- (H047), el resto: la parte a cuenta es su «compra» en el libro.
SELECT o.id, o.created_at, o.numero, (o.total - coalesce(o.a_cuenta, 0))::float8 AS total, o.estado_pago::text AS estado_pago,
  r.id AS recibo_id, r.numero AS recibo_numero, r.estado AS recibo_estado
FROM orders o
LEFT JOIN receipts r ON r.id = (SELECT x.id FROM receipts x WHERE x.order_id = o.id AND x.estado <> 'anulado'
  ORDER BY x.created_at DESC LIMIT 1)
WHERE o.customer_id = $1 AND (o.medio_pago IS NULL OR o.medio_pago <> 'cuenta_corriente') AND o.estado <> 'cancelado'
  AND (sqlc.narg(desde)::timestamptz IS NULL OR o.created_at >= sqlc.narg(desde))
ORDER BY o.created_at DESC
LIMIT $2;

-- name: PagosInformados :many
SELECT id, created_at, monto::float8 AS monto, estado::text AS estado, medio, motivo_rechazo
FROM payments
WHERE customer_id = $1 AND tipo = 'deuda' AND estado IN ('en_revision', 'rechazado')
  AND (sqlc.narg(desde)::timestamptz IS NULL OR created_at >= sqlc.narg(desde))
ORDER BY created_at DESC;

-- name: DevolucionesFueraDeLaCuenta :many
-- Las devoluciones de lo que se pagó de contado: el reintegro no pasa por
-- la cuenta y Movimientos no las mostraba, ni con «Notas y ajustes» (mes
-- simulado, M2S3-030). Las que van a la cuenta ya están en el libro.
SELECT d.id, d.created_at, d.importe::float8 AS importe, o.id AS pedido_id, o.numero AS pedido_numero,
       i.tipo::text AS nota_tipo, i.punto_venta AS nota_pv, i.numero AS nota_numero
FROM devoluciones d
JOIN orders o ON o.id = d.order_id
LEFT JOIN invoices i ON i.id = d.nota_id
WHERE o.customer_id = $1 AND d.account_movement_id IS NULL
  AND (sqlc.narg(desde)::timestamptz IS NULL OR d.created_at >= sqlc.narg(desde))
ORDER BY d.created_at DESC;

-- name: ChequesSueltos :many
-- Los cheques que no tienen recibo: los informados, los rechazados al
-- recibirlos y los que se entregaron con una venta del mostrador (mes
-- simulado: esos no figuraban en ningún lado de la ficha, ni rebotados).
-- con_nota_de_debito: el rechazo ya volvió a la cuenta con su nota de débito.
SELECT c.id, c.updated_at, c.tipo::text AS tipo, c.numero, c.banco, c.importe::float8 AS importe, c.estado::text AS estado, c.fecha_pago,
       c.motivo_rechazo, (c.order_payment_id IS NOT NULL)::boolean AS de_una_venta,
       (SELECT count(*) > 0 FROM account_movements am WHERE am.cheque_id = c.id AND am.tipo = 'nota_debito')::boolean AS con_nota_de_debito
FROM cheques c
WHERE c.customer_id = $1 AND c.sentido = 'recibido'
  AND (c.estado = 'informado' OR (c.estado = 'rechazado' AND c.receipt_id IS NULL)
       OR (c.order_payment_id IS NOT NULL AND c.receipt_id IS NULL AND c.estado <> 'anulado'))
  AND (sqlc.narg(desde)::timestamptz IS NULL OR c.created_at >= sqlc.narg(desde))
ORDER BY c.fecha_pago;

-- name: ChequesDeRecibos :many
-- Los cheques que entraron con un recibo y el banco todavía puede devolver:
-- el filtro «Cheques» de la ficha los muestra para registrar el rechazo
-- (H272); en «Todo» van en el renglón del pago.
SELECT c.id, c.updated_at, c.tipo::text AS tipo, c.numero, c.banco, c.importe::float8 AS importe, c.estado::text AS estado,
       c.fecha_pago, r.id AS recibo_id, r.numero AS recibo_numero
FROM cheques c JOIN receipts r ON r.id = c.receipt_id
WHERE c.customer_id = $1 AND c.sentido = 'recibido' AND r.estado = 'emitido'
  AND c.estado IN ('cartera', 'depositado', 'entregado')
  AND (sqlc.narg(desde)::timestamptz IS NULL OR c.created_at >= sqlc.narg(desde))
ORDER BY c.fecha_pago;

-- name: PartesDeRecibos :many
SELECT p.receipt_id, p.medio::text AS medio, p.importe::float8 AS importe, c.banco, c.numero, c.tipo,
       c.id AS cheque_id, c.estado AS cheque_estado, c.fecha_pago AS cheque_fecha_pago,
       (pay.estado IS NOT DISTINCT FROM 'aprobado' AND pay.proveedor IS NOT DISTINCT FROM 'mercado_pago')::boolean AS por_mercado_pago
FROM receipt_parts p LEFT JOIN cheques c ON c.id = p.cheque_id
LEFT JOIN payments pay ON pay.id = p.payment_id
WHERE p.receipt_id = ANY(sqlc.arg(recibos)::uuid[])
ORDER BY p.orden;
