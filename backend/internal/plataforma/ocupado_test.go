package plataforma

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Un candado ocupado o una consulta cortada por su tope no es «Algo falló»:
// sale 503, con un mensaje que dice qué pasó.
func TestOcupadoEsUn503(t *testing.T) {
	escribir := ErrorDeRespuesta(slog.New(slog.NewTextHandler(io.Discard, nil)))
	for codigo, quiero := range map[string]int{"55P03": 503, "40P01": 503, "57014": 503, "23505": 500} {
		w := httptest.NewRecorder()
		escribir(w, httptest.NewRequest(http.MethodPost, "/api/v1/mostrador/ventas", nil),
			fmt.Errorf("registrando la venta: %w", &pgconn.PgError{Code: codigo}))
		if w.Code != quiero {
			t.Errorf("%s dio %d, quería %d", codigo, w.Code, quiero)
		}
		var p struct {
			Detail string `json:"detail"`
			Title  string `json:"title"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &p)
		if quiero == 503 && p.Detail+p.Title == "" {
			t.Errorf("%s: sin mensaje (%s)", codigo, w.Body.String())
		}
	}
}

// Dos transacciones sobre el mismo candado: la segunda se corta por
// lock_timeout y EnTransaccion la vuelve a correr, hasta que la primera
// suelta. Si no suelta nunca, se rinde con el error a la vista.
func TestEnTransaccionReintentaElCandado(t *testing.T) {
	servidor := os.Getenv("MJBJ_PRUEBA_BASE")
	if servidor == "" {
		t.Skip("sin MJBJ_PRUEBA_BASE: este test necesita un Postgres")
	}
	ctx := context.Background()
	base := ConfigBase{URL: servidor, SSL: "off", Maximo: 2}
	otra, err := base.PoolCon(ctx, Topes{})
	if err != nil {
		t.Fatal(err)
	}
	defer otra.Close()
	pool, err := base.PoolCon(ctx, Topes{Candado: 100 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	// retener toma el candado y lo suelta después de `cuanto`.
	retener := func(cuanto time.Duration) (esperar func()) {
		tomado := make(chan struct{})
		listo := make(chan struct{})
		go func() {
			defer close(listo)
			_ = pgx.BeginFunc(ctx, otra, func(tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('cuenta:prueba'))`); err != nil {
					return err
				}
				close(tomado)
				time.Sleep(cuanto)
				return nil
			})
		}()
		<-tomado
		return func() { <-listo }
	}

	intentos := 0
	tomar := func(tx pgx.Tx) error {
		intentos++
		_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('cuenta:prueba'))`)
		return err
	}

	// Lo suelta a los 250 ms: el primer intento se corta a los 100, el
	// segundo arranca a los 300 y lo consigue.
	esperar := retener(250 * time.Millisecond)
	if err := EnTransaccion(ctx, pool, tomar); err != nil || intentos < 2 {
		t.Errorf("con el candado que se suelta: %v en %d intentos", err, intentos)
	}
	esperar()

	// Retenido más que todos los intentos juntos: tres intentos y el 55P03.
	intentos = 0
	esperar = retener(2 * time.Second)
	err = EnTransaccion(ctx, pool, tomar)
	if !Ocupado(err) || intentos != 3 {
		t.Errorf("con el candado tomado: %v en %d intentos", err, intentos)
	}
	esperar()

	// Un error que no es de candado no se reintenta.
	intentos = 0
	otro := errors.New("otra cosa")
	if err := EnTransaccion(ctx, pool, func(pgx.Tx) error { intentos++; return otro }); !errors.Is(err, otro) || intentos != 1 {
		t.Errorf("otro error: %v en %d intentos", err, intentos)
	}
}
