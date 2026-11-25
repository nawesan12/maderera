-- Los avisos al teléfono del personal (internal/push): las tablas de
-- lib/notificaciones/push.ts.

-- name: SuscripcionesDeUsuario :many
SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1;

-- name: SuscripcionesDeRoles :many
SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
FROM push_subscriptions ps
JOIN profiles p ON p.user_id = ps.user_id
-- Como texto: pgx no sabe codificar arreglos de un enum propio sin
-- registrarlo, y comparar el texto da lo mismo.
WHERE p.staff_role::text = ANY(sqlc.arg(roles)::text[]);

-- name: TodasLasSuscripciones :many
SELECT id, endpoint, p256dh, auth FROM push_subscriptions;

-- name: SuscripcionUsada :exec
UPDATE push_subscriptions SET ultima_vez_at = now() WHERE id = $1;

-- name: BorrarSuscripcionVencida :exec
DELETE FROM push_subscriptions WHERE id = $1;

-- name: GuardarSuscripcion :exec
INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, descripcion)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (endpoint) DO UPDATE
  SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, ultima_vez_at = now();

-- name: BorrarSuscripcion :exec
DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2;

-- name: RegistrarNotificacion :exec
INSERT INTO notifications_log (canal, evento, destinatario, asunto, estado, error)
VALUES ($1, $2, $3, $4, $5, $6);
