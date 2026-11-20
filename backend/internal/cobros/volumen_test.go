package cobros

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// El plan de eventosSQL con el volumen de ISIS (reportes/testdata/volumen.sql,
// MJBJ_VOLUMEN con la URL de la base sembrada; no corre en la suite): cuánto
// es JIT y cuánto trabajo, con el recorte y sin él, y el de la cuenta más
// grande, que es lo que corre al emitir un recibo con el candado tomado.
func TestVolumenDelPlanDeEventos(t *testing.T) {
	url := os.Getenv("MJBJ_VOLUMEN")
	if url == "" {
		t.Skip("sin MJBJ_VOLUMEN")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	hasta := time.Date(2026, 10, 31, 23, 59, 59, 0, time.FixedZone("ART", -3*3600))
	explicar := func(nombre, sql string, jit bool, args ...any) {
		t.Helper()
		if err := pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
			if !jit {
				if _, err := ApagarJIT(ctx, tx); err != nil {
					return err
				}
			}
			rs, err := tx.Query(ctx, `EXPLAIN (ANALYZE, BUFFERS) `+sql, args...)
			if err != nil {
				return err
			}
			var lineas []string
			var l string
			buffers := false
			_, err = pgx.ForEachRow(rs, []any{&l}, func() error {
				// El nodo de arriba (con el costo estimado), sus buffers, los
				// tiempos y el JIT.
				x := strings.TrimSpace(l)
				primerBuffers := !buffers && strings.HasPrefix(x, "Buffers:")
				buffers = buffers || primerBuffers
				if len(lineas) == 0 || primerBuffers || strings.Contains(x, "Time") || strings.Contains(x, "JIT") ||
					strings.HasPrefix(x, "Functions:") || strings.HasPrefix(x, "Timing:") {
					lineas = append(lineas, x)
				}
				return nil
			})
			t.Logf("%s (jit %v):\n  %s", nombre, jit, strings.Join(lineas, "\n  "))
			return err
		}); err != nil {
			t.Fatalf("%s: %v", nombre, err)
		}
	}
	var conf string
	if err := pool.QueryRow(ctx, `SELECT pg_jit_available()::text || ' jit=' || current_setting('jit') || ' jit_above_cost=' || current_setting('jit_above_cost')
		|| ' shared_buffers=' || current_setting('shared_buffers') || ' work_mem=' || current_setting('work_mem')`).Scan(&conf); err != nil {
		t.Fatal(err)
	}
	t.Logf("pg_jit_available=%s", conf)
	explicar("todas, sin recorte", todasSinRecorte, true, hasta)
	explicar("todas, sin recorte", todasSinRecorte, false, hasta)
	explicar("todas, con recorte", eventosDeTodas, true, hasta)
	explicar("todas, con recorte", eventosDeTodas, false, hasta)

	// La cuenta más grande: la de más recibos y pedidos.
	var cliente string
	var recibos, pedidos int
	if err := pool.QueryRow(ctx, `SELECT c.id::text, (SELECT count(*) FROM receipts r WHERE r.customer_id = c.id)::int AS r,
		(SELECT count(*) FROM orders o WHERE o.customer_id = c.id)::int AS o FROM customers c ORDER BY 2 + 3 DESC, 1 LIMIT 1`).Scan(&cliente, &recibos, &pedidos); err != nil {
		t.Fatal(err)
	}
	t.Logf("cuenta más grande: %d recibos, %d pedidos", recibos, pedidos)
	args := []any{time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC), "c:" + cliente, cliente, nil, nil, nil}
	explicar("una clave, sin recorte", unaClaveSinRecorte, true, args...)
	explicar("una clave, con recorte", eventosDeUnaClave, true, args...)
	explicar("una clave, con recorte", eventosDeUnaClave, false, args...)
}
