// Package tareas corre lo periódico (una vez por hora, por día, por semana) y
// se asegura de que corra una sola vez por período aunque haya varios
// procesos o el reloj se adelante: lib/tareas del TS, con la misma tabla
// (`tareas_corridas`) y los mismos períodos.
//
// Las tareas en sí son de cada dominio y se mudan con su tanda; el worker de
// Go solo corre las que tiene registradas.
package tareas

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/sqlc"
)

// Frecuencia es cada cuánto corre una tarea.
type Frecuencia string

const (
	Hora   Frecuencia = "hora"
	Dia    Frecuencia = "dia"
	Semana Frecuencia = "semana"
)

var zona = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		// Sin base de zonas (una imagen mínima sin tzdata): Argentina es UTC−3
		// fija desde 2009.
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// PeriodoDe es periodoDe del TS: «2026-10-01T23», «2026-10-01» o
// «2026-W40», siempre en hora de Buenos Aires (la tarea diaria es la del día
// de la maderera, no la del día UTC).
func PeriodoDe(f Frecuencia, t time.Time) string {
	l := t.In(zona)
	switch f {
	case Hora:
		return l.Format("2006-01-02T15")
	case Dia:
		return l.Format("2006-01-02")
	}
	anio, semana := l.ISOWeek()
	return fmt.Sprintf("%d-W%02d", anio, semana)
}

// Tarea es algo periódico.
type Tarea struct {
	Nombre     string
	Frecuencia Frecuencia
	// A partir de qué hora del día (de Buenos Aires) corre la diaria o la
	// semanal: el parte del día sale a las 7, no a medianoche.
	DesdeHora int
	// Para la semanal, desde qué día (time.Monday…).
	DesdeDia time.Weekday
	Ejecutar func(ctx context.Context) (map[string]any, error)
}

// toca dice si a esta hora ya corresponde correr la tarea de este período.
func (t Tarea) toca(ahora time.Time) bool {
	l := ahora.In(zona)
	if t.Frecuencia == Hora {
		return true
	}
	if l.Hour() < t.DesdeHora {
		return false
	}
	if t.Frecuencia == Semana {
		// Lunes=1 … domingo=7: desde el día pedido en adelante.
		dia := int(l.Weekday())
		if dia == 0 {
			dia = 7
		}
		desde := int(t.DesdeDia)
		if desde == 0 {
			desde = 7
		}
		return dia >= desde
	}
	return true
}

// Estado es cómo terminó un intento de correr una tarea.
type Estado string

const (
	Ok       Estado = "ok"
	YaCorrio Estado = "ya-corrio"
	Error    Estado = "error"
	NoToca   Estado = "no-toca"
)

// Correr corre la tarea si toca y no corrió en este período.
func Correr(ctx context.Context, q *sqlc.Queries, log *slog.Logger, t Tarea, ahora time.Time) (Estado, error) {
	if !t.toca(ahora) {
		return NoToca, nil
	}
	periodo := PeriodoDe(t.Frecuencia, ahora)
	id, err := q.EmpezarCorrida(ctx, sqlc.EmpezarCorridaParams{Tarea: t.Nombre, Periodo: periodo})
	if errors.Is(err, pgx.ErrNoRows) {
		return YaCorrio, nil
	}
	if err != nil {
		return Error, err
	}
	resultado, errTarea := t.Ejecutar(ctx)
	if errTarea != nil {
		mensaje := errTarea.Error()
		_ = q.TerminarCorrida(ctx, sqlc.TerminarCorridaParams{ID: id, Estado: sqlc.EstadoTareaError, Error: &mensaje})
		log.Error("tarea", "tarea", t.Nombre, "periodo", periodo, "error", mensaje)
		return Error, errTarea
	}
	crudo, _ := json.Marshal(resultado)
	if err := q.TerminarCorrida(ctx, sqlc.TerminarCorridaParams{ID: id, Estado: sqlc.EstadoTareaOk, Resultado: crudo}); err != nil {
		return Error, err
	}
	log.Info("tarea", "tarea", t.Nombre, "periodo", periodo, "resultado", resultado)
	return Ok, nil
}
