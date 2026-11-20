package cobros

import (
	"context"
	"os"
	"reflect"
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
				if _, err := PlanDelReparto(ctx, tx); err != nil {
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

// limiteDeFijarReparto es lo más que puede tardar FijarReparto en la cuenta
// más pesada (testdata/volumen_pesadas.sql), con los repartos fijados: corre
// con el candado de recibos tomado, y cada emisión de cualquier cliente
// espera detrás. Está escrito en docs/go/progreso.md. Hoy la mitad es leer
// los 5.000 pedidos y las 4.000 facturas de la cuenta para sus señas
// (pendientesSQL); si se pasa, lo que sigue es leer solo los que pueden estar
// abiertos a la fecha de alguna seña.
const limiteDeFijarReparto = 500 * time.Millisecond

// FijarReparto de punta a punta en la cuenta más pesada, diez veces seguidas
// en la misma conexión (pgx deja la sentencia preparada, y a partir de la
// sexta Postgres puede pasar al plan genérico), contra la misma lectura con
// el plan que elija Postgres y con el genérico forzado.
func TestVolumenDeLaCuentaPesada(t *testing.T) {
	url := os.Getenv("MJBJ_VOLUMEN")
	if url == "" {
		t.Skip("sin MJBJ_VOLUMEN")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var cliente string
	var recibos, pedidos, señas, sinFijar int
	if err := conn.QueryRow(ctx, `SELECT c.id::text, (SELECT count(*) FROM receipts r WHERE r.customer_id = c.id)::int,
		(SELECT count(*) FROM orders o WHERE o.customer_id = c.id)::int,
		(SELECT count(*) FROM receipts r WHERE r.customer_id = c.id AND r.reparto_anticipo > 0.005)::int,
		(SELECT count(*) FROM receipts r WHERE r.customer_id = c.id AND r.reparto_deudores IS NULL)::int
		FROM customers c ORDER BY 2 DESC, 1 LIMIT 1`).Scan(&cliente, &recibos, &pedidos, &señas, &sinFijar); err != nil {
		t.Fatal(err)
	}
	t.Logf("cuenta más pesada: %d recibos, %d pedidos, %d con anticipo, %d sin fijar", recibos, pedidos, señas, sinFijar)

	vueltas := func(nombre string, f func(tx pgx.Tx) error) {
		t.Helper()
		var tiempos []string
		var peor time.Duration
		for range 10 {
			tx, err := conn.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			t0 := time.Now()
			if err := f(tx); err != nil {
				t.Fatalf("%s: %v", nombre, err)
			}
			d := time.Since(t0)
			peor = max(peor, d)
			tiempos = append(tiempos, d.Round(time.Millisecond).String())
			if err := tx.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
		}
		t.Logf("%-40s %s (peor %v)", nombre, strings.Join(tiempos, " "), peor.Round(time.Millisecond))
		if nombre == "FijarReparto" && sinFijar == 0 && peor > limiteDeFijarReparto {
			t.Errorf("FijarReparto tarda %v en la cuenta más pesada: el límite es %v", peor, limiteDeFijarReparto)
		}
	}
	fin := time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)
	vueltas("FijarReparto", func(tx pgx.Tx) error {
		var id string
		if err := tx.QueryRow(ctx, `INSERT INTO receipts (numero, recibido_de, total, origen, customer_id)
			VALUES ('REC-PESADA', 'Constructora', 1000, 'panel', $1) RETURNING id`, cliente).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO receipt_parts (receipt_id, medio, importe, orden) VALUES ($1, 'transferencia', 1000, 0)`, id); err != nil {
			return err
		}
		_, err := FijarReparto(ctx, tx, id)
		return err
	})
	for _, modo := range []string{"auto", "force_generic_plan"} {
		vueltas("CargarEventos, plan_cache_mode="+modo, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `SET LOCAL jit = off`); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `SELECT set_config('plan_cache_mode', $1, true)`, modo); err != nil {
				return err
			}
			_, err := CargarEventos(ctx, tx, fin, "c:"+cliente)
			return err
		})
	}
}

// Con el volumen, CargarEventos da el mismo reparto entero que el SQL de
// producción de antes (el LATERAL por recibo), de todas las cuentas y de la
// más pesada. Tarda: el SQL de antes es el que tardaba.
func TestVolumenLosPendientesDanLoMismo(t *testing.T) {
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
	if _, err := pool.Exec(ctx, `SET jit = off`); err != nil {
		t.Fatal(err)
	}
	var cliente string
	if err := pool.QueryRow(ctx, `SELECT c.id::text FROM customers c ORDER BY (SELECT count(*) FROM receipts r WHERE r.customer_id = c.id) DESC, 1 LIMIT 1`).Scan(&cliente); err != nil {
		t.Fatal(err)
	}
	for _, clave := range []string{"", "c:" + cliente} {
		for _, hasta := range []time.Time{time.Date(2026, 10, 31, 23, 59, 59, 0, time.FixedZone("ART", -3*3600)), time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)} {
			t0 := time.Now()
			ahora, err := CargarEventos(ctx, pool, hasta, clave)
			if err != nil {
				t.Fatal(err)
			}
			d0 := time.Since(t0)
			t1 := time.Now()
			antes, err := cargarCon(ctx, pool, todasDeAntes, unaClaveDeAntes, hasta, clave)
			if err != nil {
				t.Fatal(err)
			}
			a, b := RepartirCobros(ahora), RepartirCobros(antes)
			t.Logf("clave %q hasta %s: %d eventos, %d recibos, %d bolsas; ahora %v, antes %v", clave, hasta.Format("2006-01-02"), len(ahora),
				len(a.Recibos), len(a.Bolsas), d0.Round(time.Millisecond), time.Since(t1).Round(time.Millisecond))
			if !reflect.DeepEqual(a, b) {
				t.Errorf("clave %q hasta %v: el reparto cambió", clave, hasta)
			}
		}
	}
}
