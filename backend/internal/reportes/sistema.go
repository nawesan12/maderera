package reportes

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// La pantalla /admin/sistema (mes simulado, M2S2-061): el aviso de un trabajo
// automático que agotó los intentos llevaba a una dirección que no existía.
// Muestra lo que falló de la cola, con su error, y la última corrida de cada
// tarea del worker; un trabajo fallido se puede volver a intentar.

// TrabajoDelSistema es un trabajo de la cola que falló o que sigue
// reintentando con error.
type TrabajoDelSistema struct {
	ID          string     `json:"id"`
	Tipo        string     `json:"tipo"`
	Estado      string     `json:"estado"`
	Intentos    int32      `json:"intentos"`
	MaxIntentos int32      `json:"maxIntentos"`
	UltimoError *string    `json:"ultimoError"`
	CreatedAt   time.Time  `json:"createdAt"`
	TerminadoAt *time.Time `json:"terminadoAt"`
}

// TareaDelSistema es la última corrida de una tarea periódica.
type TareaDelSistema struct {
	Tarea       string     `json:"tarea"`
	Periodo     string     `json:"periodo"`
	Estado      string     `json:"estado"`
	Error       *string    `json:"error"`
	IniciadaAt  time.Time  `json:"iniciadaAt"`
	TerminadaAt *time.Time `json:"terminadaAt"`
}

// EstadoDelSistema es lo que muestra la pantalla.
type EstadoDelSistema struct {
	Trabajos   []TrabajoDelSistema `json:"trabajos"`
	Tareas     []TareaDelSistema   `json:"tareas"`
	Pendientes int                 `json:"pendientes"`
}

// Sistema lee los trabajos fallidos (o con error y todavía reintentando) de
// los últimos 30 días, los 50 más nuevos, y la última corrida de cada tarea.
func (s *Servicio) Sistema(ctx context.Context) (EstadoDelSistema, error) {
	out := EstadoDelSistema{Trabajos: []TrabajoDelSistema{}, Tareas: []TareaDelSistema{}}
	rs, err := s.pool.Query(ctx, `
		SELECT id, tipo, estado::text, intentos, max_intentos, ultimo_error, created_at, terminado_at
		FROM trabajos
		WHERE (estado = 'fallido' OR (estado IN ('pendiente', 'procesando') AND ultimo_error IS NOT NULL))
		  AND created_at >= now() - interval '30 days'
		ORDER BY created_at DESC LIMIT 50`)
	if err != nil {
		return out, err
	}
	if out.Trabajos, err = pgx.CollectRows(rs, pgx.RowToStructByPos[TrabajoDelSistema]); err != nil {
		return out, err
	}
	rs, err = s.pool.Query(ctx, `
		SELECT DISTINCT ON (tarea) tarea, periodo, estado::text, error, iniciada_at, terminada_at
		FROM tareas_corridas ORDER BY tarea, iniciada_at DESC`)
	if err != nil {
		return out, err
	}
	if out.Tareas, err = pgx.CollectRows(rs, pgx.RowToStructByPos[TareaDelSistema]); err != nil {
		return out, err
	}
	err = s.pool.QueryRow(ctx, `SELECT count(*)::int FROM trabajos WHERE estado = 'pendiente'`).Scan(&out.Pendientes)
	return out, err
}

// ReintentarTrabajo vuelve a poner en la cola un trabajo fallido, con los
// intentos en cero. Devuelve falso si no existe o no estaba fallido.
func (s *Servicio) ReintentarTrabajo(ctx context.Context, id string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE trabajos SET estado = 'pendiente', intentos = 0, proximo_intento_at = now(),
		tomado_hasta = NULL, terminado_at = NULL WHERE id = $1 AND estado = 'fallido'`, id)
	return tag.RowsAffected() == 1, err
}
