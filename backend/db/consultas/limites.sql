-- El limitador de intentos (internal/limites): la misma tabla y las mismas
-- claves que lib/limites del TypeScript, así los dos cuentan juntos mientras
-- convivan.

-- name: ContarIntento :one
INSERT INTO rate_limits (clave, ventana, cuenta) VALUES ($1, $2, 1)
ON CONFLICT (clave, ventana) DO UPDATE SET cuenta = rate_limits.cuenta + 1
RETURNING cuenta;

-- name: SoltarIntentos :exec
DELETE FROM rate_limits WHERE clave = $1 AND ventana = $2;

-- name: BorrarVentanasViejas :execrows
DELETE FROM rate_limits WHERE ventana < $1;
