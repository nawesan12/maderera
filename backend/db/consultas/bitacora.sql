-- La bitácora del panel (internal/bitacora): la misma tabla que
-- registrarEnBitacora (lib/dal/admin/auditoria.ts).

-- name: AnotarEnBitacora :exec
INSERT INTO audit_log (usuario_id, usuario_nombre, usuario_email, usuario_rol, accion, entidad, entidad_id, descripcion, detalle)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
