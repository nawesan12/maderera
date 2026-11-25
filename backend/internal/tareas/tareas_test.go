package tareas

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

func en(s string) time.Time { t, _ := time.Parse(time.RFC3339, s); return t }

// Los casos de tests/tareas.test.ts.
func TestPeriodoComoElTS(t *testing.T) {
	noche := en("2026-10-02T02:30:00Z")
	casos := []struct {
		f    Frecuencia
		t    time.Time
		want string
	}{
		{Dia, noche, "2026-10-01"},
		{Hora, noche, "2026-10-01T23"},
		{Semana, en("2026-10-01T15:00:00Z"), "2026-W40"},
		{Semana, en("2027-01-01T15:00:00Z"), "2026-W53"},
		{Semana, en("2027-01-04T15:00:00Z"), "2027-W01"},
	}
	for _, c := range casos {
		if got := PeriodoDe(c.f, c.t); got != c.want {
			t.Errorf("PeriodoDe(%s, %v) = %q, el TS da %q", c.f, c.t, got, c.want)
		}
	}
}

func TestUnaVezPorPeriodo(t *testing.T) {
	pool := pruebas.Base(t)
	q := sqlc.New(pool)
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	veces := 0
	fallar := true
	tarea := Tarea{Nombre: "prueba-diaria", Frecuencia: Dia, DesdeHora: 7, Ejecutar: func(context.Context) (map[string]any, error) {
		veces++
		if fallar {
			return nil, errors.New("se cayó")
		}
		return map[string]any{"listo": true}, nil
	}}
	temprano := en("2026-10-24T09:00:00Z") // 6 de la mañana en Buenos Aires
	if e, _ := Correr(ctx, q, log, tarea, temprano); e != NoToca || veces != 0 {
		t.Fatalf("corrió antes de las 7: %s", e)
	}
	ahora := en("2026-10-24T11:00:00Z")
	if e, _ := Correr(ctx, q, log, tarea, ahora); e != Error {
		t.Fatalf("tenía que fallar: %s", e)
	}
	// Falló: se reintenta en el mismo período.
	fallar = false
	if e, _ := Correr(ctx, q, log, tarea, ahora); e != Ok || veces != 2 {
		t.Fatalf("el reintento: %s veces=%d", e, veces)
	}
	if e, _ := Correr(ctx, q, log, tarea, ahora.Add(5*time.Hour)); e != YaCorrio || veces != 2 {
		t.Fatalf("corrió dos veces el mismo día: %s", e)
	}
	// Al otro día, sí.
	if e, _ := Correr(ctx, q, log, tarea, ahora.Add(24*time.Hour)); e != Ok || veces != 3 {
		t.Fatalf("al otro día: %s", e)
	}
	var resultado string
	_ = pool.QueryRow(ctx, `select resultado::text from tareas_corridas where tarea = 'prueba-diaria' and periodo = '2026-10-24'`).Scan(&resultado)
	if resultado != `{"listo": true}` {
		t.Errorf("resultado guardado: %q", resultado)
	}
}
