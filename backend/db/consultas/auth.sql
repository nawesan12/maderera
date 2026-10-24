-- La sesión: las mismas tablas y filas que escribía better-auth
-- (lib/auth-options.ts), para que las sesiones y claves de antes sigan
-- sirviendo. Ver internal/auth.

-- name: SesionPorToken :one
-- La sesión con su usuario y su perfil. El perfil puede faltar (un usuario
-- creado a mano sin perfil): entonces es cliente, como decía getSession().
SELECT s.id, s.token, s.expires_at, s.created_at,
       u.id AS user_id, u.name, u.email,
       p.role AS rol, p.staff_role AS rol_staff, p.price_list_id
FROM session s
JOIN "user" u ON u.id = s.user_id
LEFT JOIN profiles p ON p.user_id = u.id
WHERE s.token = $1;

-- name: RenovarSesion :one
UPDATE session SET expires_at = $2, updated_at = $3
WHERE token = $1
RETURNING expires_at;

-- name: BorrarSesion :exec
DELETE FROM session WHERE token = $1;

-- name: CrearSesion :exec
INSERT INTO session (id, token, expires_at, created_at, updated_at, ip_address, user_agent, user_id)
VALUES ($1, $2, $3, $4, $4, $5, $6, $7);

-- name: CuentaConClave :one
-- Para entrar: el usuario por su correo y el hash de su clave.
SELECT u.id, u.name, u.email, a.password
FROM "user" u
JOIN account a ON a.user_id = u.id AND a.provider_id = 'credential'
WHERE u.email = $1;

-- name: ExisteCorreo :one
SELECT EXISTS (SELECT 1 FROM "user" WHERE email = $1);

-- name: CrearUsuario :exec
INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
VALUES ($1, $2, $3, false, $4, $4);

-- name: CrearCuentaConClave :exec
-- issuer 'local:credential' y account_id = id del usuario: es lo que escribe
-- better-auth 1.7 (sign-up, createLocalAccountIssuer).
INSERT INTO account (id, issuer, account_id, provider_id, user_id, password, created_at, updated_at)
VALUES ($1, 'local:credential', $2, 'credential', $2, $3, $4, $4);

-- name: CrearPerfilDeCliente :exec
-- Todo usuario nace cliente: el rol nunca sale de lo que manda quien se
-- registra (ver databaseHooks en lib/auth-options.ts).
INSERT INTO profiles (user_id, role) VALUES ($1, 'cliente');

-- name: CambiarClave :exec
UPDATE account SET password = $2, updated_at = $3
WHERE user_id = $1 AND provider_id = 'credential';

-- name: BorrarOtrasSesiones :exec
DELETE FROM session WHERE user_id = $1 AND token <> $2;

-- name: CrearClienteDeRegistro :exec
-- La ficha comercial de quien se registra desde el sitio: de ahí cuelgan
-- después pedidos y presupuestos (app/(auth)/registro/actions.ts).
INSERT INTO customers (user_id, nombre, email, telefono, tipo, limite_credito, notas)
VALUES ($1, $2, $3, $4, 'particular', 0, 'Cuenta creada desde el sitio.');

-- Para los comandos de alta a mano (mjbj usuario staff|cliente), que
-- reemplazan a lib/db/create-staff.ts y create-cliente.ts.

-- name: UsuarioPorCorreo :one
SELECT u.id, u.name,
       EXISTS (SELECT 1 FROM account a WHERE a.user_id = u.id AND a.provider_id = 'credential') AS con_clave
FROM "user" u WHERE u.email = $1;

-- name: BorrarUsuario :exec
DELETE FROM "user" WHERE id = $1;

-- name: HacerStaff :exec
INSERT INTO profiles (user_id, role, staff_role) VALUES ($1, 'staff', $2)
ON CONFLICT (user_id) DO UPDATE SET role = 'staff', staff_role = EXCLUDED.staff_role, updated_at = now();

-- name: FichaSinUsuarioPorCorreo :one
SELECT id, nombre, tipo FROM customers WHERE email = $1 AND user_id IS NULL LIMIT 1;

-- name: VincularFicha :exec
UPDATE customers SET user_id = $2, updated_at = now() WHERE id = $1;

-- name: HacerProfesional :exec
UPDATE profiles SET role = 'profesional', updated_at = now() WHERE user_id = $1;

-- name: TieneFicha :one
SELECT EXISTS (SELECT 1 FROM customers WHERE user_id = $1);

-- name: CrearFichaManual :exec
INSERT INTO customers (user_id, nombre, email, tipo, limite_credito, notas)
VALUES ($1, $2, $3, 'particular', 0, 'Cuenta creada con cliente:create.');
