package cola

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

func TestEsperaComoElTS(t *testing.T) {
	for intentos, want := range map[int32]time.Duration{1: 30 * time.Second, 2: time.Minute, 4: 4 * time.Minute, 20: time.Hour, 0: 30 * time.Second, 99: time.Hour} {
		if got := EsperaParaElIntento(intentos); got != want {
			t.Errorf("EsperaParaElIntento(%d) = %v, el TS da %v", intentos, got, want)
		}
	}
}

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

func TestColaContraLaBase(t *testing.T) {
	pool := pruebas.Base(t)
	q := sqlc.New(pool)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if _, err := Encolar(ctx, q, "prueba.bien", map[string]int{"n": i}, time.Time{}); err != nil {
			t.Fatal(err)
		}
	}
	_, _ = Encolar(ctx, q, "prueba.mal", map[string]string{}, time.Time{})
	// Un tipo que no es de este proceso (lo hace el TS): no se toca.
	_, _ = Encolar(ctx, q, "pago.aviso", map[string]string{}, time.Time{})
	// Uno para más tarde: todavía no.
	_, _ = Encolar(ctx, q, "prueba.bien", map[string]int{"n": 99}, time.Now().Add(time.Hour))

	c := Nueva(q, silencio)
	var vistos []int
	c.Registrar("prueba.bien", func(_ context.Context, carga json.RawMessage) error {
		var v struct{ N int }
		_ = json.Unmarshal(carga, &v)
		vistos = append(vistos, v.N)
		return nil
	})
	var fallidos []string
	c.AlFallar = func(_ context.Context, tipo, _ string) { fallidos = append(fallidos, tipo) }
	c.Registrar("prueba.mal", func(context.Context, json.RawMessage) error { return errors.New("se rompió") })

	r, err := c.Procesar(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	if r.Hechos != 3 || r.Reintentos != 1 || len(vistos) != 3 {
		t.Fatalf("primera pasada: %+v vistos=%v", r, vistos)
	}
	var estado, ultimo string
	var prox time.Time
	_ = pool.QueryRow(ctx, `select estado, ultimo_error, proximo_intento_at from trabajos where tipo = 'prueba.mal'`).Scan(&estado, &ultimo, &prox)
	if estado != "pendiente" || ultimo != "se rompió" || time.Until(prox) < 25*time.Second {
		t.Errorf("el que falló: %s %q %v", estado, ultimo, time.Until(prox))
	}
	var ajeno string
	_ = pool.QueryRow(ctx, `select estado from trabajos where tipo = 'pago.aviso'`).Scan(&ajeno)
	if ajeno != "pendiente" {
		t.Errorf("tocó un trabajo que no es suyo: %s", ajeno)
	}

	// Agotado: con el último intento, queda fallido y avisa.
	_, _ = pool.Exec(ctx, `update trabajos set intentos = max_intentos - 1, proximo_intento_at = now() where tipo = 'prueba.mal'`)
	r, _ = c.Procesar(ctx, 50)
	_ = pool.QueryRow(ctx, `select estado from trabajos where tipo = 'prueba.mal'`).Scan(&estado)
	if r.Fallidos != 1 || estado != "fallido" || len(fallidos) != 1 {
		t.Errorf("agotado: %+v estado=%s avisos=%v", r, estado, fallidos)
	}

	// Un pánico en el manejador no tira el worker: es un fallo más.
	c.Registrar("prueba.panico", func(context.Context, json.RawMessage) error { panic("ups") })
	_, _ = Encolar(ctx, q, "prueba.panico", nil, time.Time{})
	if r, err := c.Procesar(ctx, 5); err != nil || r.Reintentos != 1 {
		t.Errorf("pánico: %+v %v", r, err)
	}
}

func TestDosProcesosNoRepiten(t *testing.T) {
	pool := pruebas.Base(t)
	q := sqlc.New(pool)
	ctx := context.Background()
	const n = 200
	for i := 0; i < n; i++ {
		_, _ = Encolar(ctx, q, "prueba.contar", map[string]int{"n": i}, time.Time{})
	}
	var hechos atomic.Int64
	var mu sync.Mutex
	vistos := map[int]int{}
	var wg sync.WaitGroup
	for w := 0; w < 4; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c := Nueva(sqlc.New(pool), silencio)
			c.Registrar("prueba.contar", func(_ context.Context, carga json.RawMessage) error {
				var v struct{ N int }
				_ = json.Unmarshal(carga, &v)
				mu.Lock()
				vistos[v.N]++
				mu.Unlock()
				hechos.Add(1)
				return nil
			})
			for {
				r, err := c.Procesar(ctx, 10)
				if err != nil {
					t.Error(err)
					return
				}
				if r.Hechos == 0 {
					return
				}
			}
		}()
	}
	wg.Wait()
	if hechos.Load() != n || len(vistos) != n {
		t.Fatalf("hechos=%d distintos=%d, tenían que ser %d", hechos.Load(), len(vistos), n)
	}
	for k, v := range vistos {
		if v != 1 {
			t.Fatalf("el trabajo %d se hizo %d veces", k, v)
		}
	}
}

// El benchmark de la tanda 1 (bench/tanda1): 2000 trabajos vacíos, un
// proceso tomando de a uno. Mide lo que cuesta la cola en sí (tomar, marcar
// hecho), no los trabajos.
func BenchmarkCola2000(b *testing.B) {
	pool := pruebas.Base(b)
	q := sqlc.New(pool)
	ctx := context.Background()
	c := Nueva(q, silencio)
	c.Registrar("bench.vacio", func(context.Context, json.RawMessage) error { return nil })
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		_, _ = pool.Exec(ctx, `insert into trabajos (tipo, carga) select 'bench.vacio', '{}'::jsonb from generate_series(1, 2000)`)
		b.StartTimer()
		for {
			r, err := c.Procesar(ctx, 500)
			if err != nil {
				b.Fatal(err)
			}
			if r.Hechos == 0 {
				break
			}
		}
	}
	b.ReportMetric(2000*float64(b.N)/b.Elapsed().Seconds(), "trabajos/s")
}
