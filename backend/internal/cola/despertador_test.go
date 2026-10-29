package cola

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// Encolar despierta al worker al confirmarse, sin esperar su vuelta.
func TestEncolarDespierta(t *testing.T) {
	pool := pruebas.Base(t)
	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()
	url := pool.Config().ConnString()
	despertar := Despertador(ctx, url, slog.New(slog.NewTextHandler(io.Discard, nil)))
	// Que la escucha esté arriba antes de encolar: un aviso de prueba.
	listo := time.Now().Add(5 * time.Second)
	for {
		_, _ = pool.Exec(ctx, `select pg_notify('mjbj_cola', 'prueba')`)
		select {
		case <-despertar:
		case <-time.After(100 * time.Millisecond):
			if time.Now().Before(listo) {
				continue
			}
			t.Fatal("la escucha no arrancó")
		}
		break
	}
	inicio := time.Now()
	if _, err := Encolar(ctx, sqlc.New(pool), "prueba.despertar", map[string]int{"n": 1}, time.Time{}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-despertar:
		if d := time.Since(inicio); d > time.Second {
			t.Errorf("tardó %v en despertar", d)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("encolar no despertó al worker")
	}
}
