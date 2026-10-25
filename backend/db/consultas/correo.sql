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

-- name: ProveedoresEntreCorreos :many
-- De estos correos, cuáles son de un proveedor activo (para el avatar azul
-- y para no proponer presupuestos a quien nos vende).
SELECT DISTINCT lower(email)::text AS correo
FROM suppliers
WHERE active AND email IS NOT NULL AND lower(email) = ANY(sqlc.arg(correos)::text[]);

-- name: FichaPorCorreo :one
-- La ficha del remitente. El correo no es único en customers: si hay
-- varias, la que tiene cuenta en el sitio y después la más nueva. El saldo
-- es la suma de los movimientos (positivo = debe), igual que
-- saldoDeCliente en lib/dal/credito.ts.
SELECT c.id, c.nombre, c.razon_social, c.cuit, c.tipo::text AS tipo, c.estado::text AS estado,
  c.limite_credito, c.dias_credito, c.cuenta_bloqueada, c.motivo_bloqueo, c.telefono, c.price_list_id,
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

-- name: PersonasDelCorreo :many
-- La gente de staff a la que se le puede asignar una conversación.
SELECT u.id, u.name AS nombre, lower(u.email)::text AS correo, p.staff_role::text AS rol
FROM "user" u
JOIN profiles p ON p.user_id = u.id
WHERE p.role = 'staff' AND p.staff_role IN ('admin', 'vendedor')
ORDER BY u.name;

-- --- Lo propio del correo: conversaciones, notas, seguimientos, plantillas.

-- name: HilosDe :many
SELECT h.hilo, h.estado, coalesce(h.asignado_a, '')::text AS asignado_a, coalesce(u.name, '')::text AS asignado_nombre,
  (SELECT count(*) FROM correo_notas n WHERE n.casilla = h.casilla AND n.hilo = h.hilo)::int AS notas
FROM correo_hilos h
LEFT JOIN "user" u ON u.id = h.asignado_a
WHERE h.casilla = sqlc.arg(casilla) AND h.hilo = ANY(sqlc.arg(hilos)::text[]);

-- name: GuardarHilo :exec
-- Asigna y cambia el estado. Un estado o un asignado vacíos no se tocan:
-- se cambia uno sin pisar el otro. `soltar` deja la conversación sin dueño.
INSERT INTO correo_hilos (casilla, hilo, asunto, remitente, estado, asignado_a, recibido_at)
VALUES (sqlc.arg(casilla), sqlc.arg(hilo), sqlc.arg(asunto), sqlc.arg(remitente),
  coalesce(nullif(sqlc.arg(estado)::text, ''), 'nuevo'), nullif(sqlc.arg(asignado_a)::text, ''), sqlc.narg(recibido_at))
ON CONFLICT (casilla, hilo) DO UPDATE SET
  estado = coalesce(nullif(sqlc.arg(estado)::text, ''), correo_hilos.estado),
  asignado_a = CASE WHEN sqlc.arg(soltar)::bool THEN NULL
    ELSE coalesce(nullif(sqlc.arg(asignado_a)::text, ''), correo_hilos.asignado_a) END,
  asunto = CASE WHEN correo_hilos.asunto = '' THEN excluded.asunto ELSE correo_hilos.asunto END,
  remitente = CASE WHEN correo_hilos.remitente = '' THEN excluded.remitente ELSE correo_hilos.remitente END,
  recibido_at = coalesce(correo_hilos.recibido_at, excluded.recibido_at),
  updated_at = now();

-- name: AnotarRespuesta :exec
-- Al contestar desde el correo: la primera respuesta queda para el tiempo
-- de respuesta, y una conversación nueva pasa a «esperando al cliente».
INSERT INTO correo_hilos (casilla, hilo, asunto, remitente, estado, asignado_a, recibido_at, respondido_at, respondido_por)
VALUES (sqlc.arg(casilla), sqlc.arg(hilo), sqlc.arg(asunto), sqlc.arg(remitente), 'esperando',
  nullif(sqlc.arg(persona)::text, ''), sqlc.narg(recibido_at), now(), nullif(sqlc.arg(persona)::text, ''))
ON CONFLICT (casilla, hilo) DO UPDATE SET
  respondido_at = coalesce(correo_hilos.respondido_at, now()),
  respondido_por = coalesce(correo_hilos.respondido_por, excluded.respondido_por),
  asignado_a = coalesce(correo_hilos.asignado_a, excluded.asignado_a),
  recibido_at = coalesce(correo_hilos.recibido_at, excluded.recibido_at),
  estado = CASE WHEN correo_hilos.estado IN ('nuevo', 'en-curso') THEN 'esperando' ELSE correo_hilos.estado END,
  updated_at = now();

-- name: NotasDe :many
SELECT id, autor, texto, created_at FROM correo_notas
WHERE casilla = $1 AND hilo = $2
ORDER BY created_at;

-- name: CrearNota :one
INSERT INTO correo_notas (casilla, hilo, autor_id, autor, texto)
VALUES (sqlc.arg(casilla), sqlc.arg(hilo), nullif(sqlc.arg(autor_id)::text, ''), sqlc.arg(autor), sqlc.arg(texto))
RETURNING id, autor, texto, created_at;

-- name: BorrarNota :execrows
DELETE FROM correo_notas WHERE id = $1 AND casilla = $2;

-- name: TiemposDeRespuesta :many
-- Cuánto se tarda en contestar, por persona, en los últimos N días: la
-- mediana y cuántas conversaciones. Solo las que se contestaron desde el
-- correo y tienen la fecha de llegada.
SELECT coalesce(u.name, 'Sin nombre')::text AS persona, count(*)::int AS conversaciones,
  (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM h.respondido_at - h.recibido_at)))::float8 AS mediana_segundos
FROM correo_hilos h
LEFT JOIN "user" u ON u.id = h.respondido_por
WHERE h.casilla = sqlc.arg(casilla) AND h.respondido_at IS NOT NULL AND h.recibido_at IS NOT NULL
  AND h.respondido_at >= now() - make_interval(days => sqlc.arg(dias)::int)
  AND h.respondido_at >= h.recibido_at
GROUP BY u.name
ORDER BY mediana_segundos;

-- name: CrearSeguimiento :one
INSERT INTO correo_seguimientos (casilla, hilo, para, asunto, enviado_at, vence_at, creado_por)
VALUES (sqlc.arg(casilla), sqlc.arg(hilo), sqlc.arg(para), sqlc.arg(asunto), sqlc.arg(enviado_at), sqlc.arg(vence_at),
  nullif(sqlc.arg(creado_por)::text, ''))
RETURNING id;

-- name: SeguimientosPendientes :many
SELECT id, hilo, para, asunto, enviado_at, vence_at FROM correo_seguimientos
WHERE casilla = $1 AND estado = 'pendiente'
ORDER BY vence_at;

-- name: ResolverSeguimiento :execrows
UPDATE correo_seguimientos SET estado = sqlc.arg(estado), resuelto_at = now()
WHERE id = sqlc.arg(id) AND casilla = sqlc.arg(casilla) AND estado = 'pendiente';

-- name: Plantillas :many
SELECT id, titulo, atajo, texto, updated_at FROM correo_plantillas
WHERE casilla = $1 ORDER BY titulo;

-- name: GuardarPlantilla :one
INSERT INTO correo_plantillas (casilla, titulo, atajo, texto)
VALUES (sqlc.arg(casilla), sqlc.arg(titulo), sqlc.arg(atajo), sqlc.arg(texto))
ON CONFLICT (casilla, titulo) DO UPDATE SET atajo = excluded.atajo, texto = excluded.texto, updated_at = now()
RETURNING id;

-- name: BorrarPlantilla :execrows
DELETE FROM correo_plantillas WHERE id = $1 AND casilla = $2;
