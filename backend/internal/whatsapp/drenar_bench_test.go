package whatsapp

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/cola"
	"mjbj/internal/push"
	"mjbj/internal/sqlc"
)

// TestDrenarBench es la mitad Go del drenaje del benchmark de la tanda 9
// (bench/tanda9): procesa con los manejadores del worker todos los
// whatsapp.payload pendientes de la base que se le diga, sin la espera de
// dos segundos entre pasadas del worker, y dice cuánto tardó. Sin
// MJBJ_BENCH_BASE no corre.
//
//	MJBJ_BENCH_BASE=postgres://…/bench_t9 go test -run TestDrenarBench -v ./internal/whatsapp
func TestDrenarBench(t *testing.T) {
	url := os.Getenv("MJBJ_BENCH_BASE")
	if url == "" {
		t.Skip("sin MJBJ_BENCH_BASE")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	// Con el avisador sin claves, como el TS: cada «escribió Marta» deja su fila.
	wa := Nuevo(pool, Config{AppSecret: secretoPrueba, CarpetaPrivada: t.TempDir()}, push.Nuevo(push.Config{}, sqlc.New(pool), silencio), silencio)
	c := cola.Nueva(sqlc.New(pool), silencio)
	wa.Registrar(c)
	inicio := time.Now()
	hechos := 0
	for {
		r, err := c.Procesar(ctx, 100)
		if err != nil {
			t.Fatal(err)
		}
		hechos += r.Hechos + r.Fallidos
		if r.Hechos+r.Reintentos+r.Fallidos == 0 {
			break
		}
	}
	t.Logf("drenaje-go %d payloads en %.1f s", hechos, time.Since(inicio).Seconds())
}
