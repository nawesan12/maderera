package tareas

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// La tarea horaria después de una caída (mes simulado, M2S1-174, M3S1-085,
// M3S1-059): vencer-portada pasó de T00 a T05 sin rastro de las cuatro
// horas que faltaron. La corrida que vuelve las recupera de una vez y lo
// deja anotado.
func TestLaHorariaAnotaLoQueRecupera(t *testing.T) {
	if n := HorasEntre("2026-11-26T00", "2026-11-26T05"); n != 4 {
		t.Fatalf("T00 → T05: %d", n)
	}
	if n := HorasEntre("2026-11-26T04", "2026-11-26T05"); n != 0 {
		t.Fatalf("seguidas: %d", n)
	}
	pool := pruebas.Base(t)
	q := sqlc.New(pool)
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	tarea := Tarea{Nombre: "vencer-portada", Frecuencia: Hora, Ejecutar: func(context.Context) (map[string]any, error) {
		return map[string]any{"invalidadas": 2}, nil
	}}
	if e, err := Correr(ctx, q, log, tarea, en("2026-11-26T03:10:00Z")); e != Ok || err != nil { // T00
		t.Fatal(e, err)
	}
	if e, err := Correr(ctx, q, log, tarea, en("2026-11-26T08:37:00Z")); e != Ok || err != nil { // T05
		t.Fatal(e, err)
	}
	var resultado string
	_ = pool.QueryRow(ctx, `select resultado::text from tareas_corridas where tarea = 'vencer-portada' and periodo = '2026-11-26T05'`).Scan(&resultado)
	if !strings.Contains(resultado, `"recupera": 4`) || !strings.Contains(resultado, `"desde": "2026-11-26T00"`) {
		t.Errorf("resultado: %s", resultado)
	}
	_ = pool.QueryRow(ctx, `select resultado::text from tareas_corridas where tarea = 'vencer-portada' and periodo = '2026-11-26T00'`).Scan(&resultado)
	if strings.Contains(resultado, "recupera") {
		t.Errorf("la primera no recupera nada: %s", resultado)
	}
}
