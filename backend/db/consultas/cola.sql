-- La cola de trabajos (internal/cola) y las corridas de tareas
-- (internal/tareas): las mismas tablas que lib/cola y lib/tareas del TS.

-- name: Encolar :one
INSERT INTO trabajos (tipo, carga, proximo_intento_at) VALUES ($1, $2, $3)
RETURNING id;

-- name: TomarTrabajo :one
-- Uno por vez, con SKIP LOCKED: varios procesos pueden tomar en paralelo sin
-- pisarse. Solo los tipos que este proceso sabe hacer: mientras Next y Go
-- convivan, cada tipo de trabajo es de uno solo. Lo tomado vence a los 5
-- minutos: si el proceso se muere a mitad, otro lo retoma.
UPDATE trabajos
   SET estado = 'procesando',
       intentos = intentos + 1,
       tomado_hasta = now() + interval '5 minutes'
 WHERE id = (
   SELECT t.id FROM trabajos t
    WHERE ((t.estado = 'pendiente' AND t.proximo_intento_at <= now())
        OR (t.estado = 'procesando' AND t.tomado_hasta < now()))
      AND t.tipo = ANY(sqlc.arg(tipos)::text[])
    ORDER BY t.proximo_intento_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
 )
RETURNING id, tipo, carga, intentos, max_intentos;

-- name: TrabajoHecho :exec
UPDATE trabajos
   SET estado = 'hecho', terminado_at = now(), tomado_hasta = null, ultimo_error = null
 WHERE id = $1;

-- name: TrabajoFallo :exec
UPDATE trabajos
   SET estado = sqlc.arg(estado)::estado_trabajo,
       ultimo_error = sqlc.arg(error),
       tomado_hasta = null,
       proximo_intento_at = now() + make_interval(secs => sqlc.arg(espera_segundos)::float8),
       terminado_at = CASE WHEN sqlc.arg(estado)::estado_trabajo = 'fallido' THEN now() END
 WHERE id = sqlc.arg(id);

-- name: EmpezarCorrida :one
-- Una tarea corre una vez por período. Si la corrida anterior falló, o quedó
-- «corriendo» hace más de media hora (el proceso se murió), se reintenta.
INSERT INTO tareas_corridas (tarea, periodo) VALUES ($1, $2)
ON CONFLICT (tarea, periodo) DO UPDATE
  SET estado = 'corriendo', iniciada_at = now(), terminada_at = null, error = null, resultado = null
  WHERE tareas_corridas.estado = 'error'
     OR (tareas_corridas.estado = 'corriendo' AND tareas_corridas.iniciada_at < now() - interval '30 minutes')
RETURNING id;

-- name: TerminarCorrida :exec
UPDATE tareas_corridas
   SET estado = $2, terminada_at = now(), resultado = $3, error = $4
 WHERE id = $1;
