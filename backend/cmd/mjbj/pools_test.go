package main

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"mjbj/internal/plataforma"
)

// Cada pool de la API sale con sus topes puestos en la conexión, y el de
// reportes no puede escribir: lo rechaza la base, no una convención.
func TestTopesDeLosPools(t *testing.T) {
	servidor := os.Getenv("MJBJ_PRUEBA_BASE")
	if servidor == "" {
		t.Skip("sin MJBJ_PRUEBA_BASE: este test necesita un Postgres")
	}
	ctx := context.Background()
	base := plataforma.ConfigBase{URL: servidor, SSL: "off", Maximo: 2}
	casos := []struct {
		nombre              string
		topes               plataforma.Topes
		sentencia, candado  string
		ociosa, soloLectura string
	}{
		{"principal", topesDeLaAPI, "30s", "10s", "1min", "off"},
		{"reportes", topesDeReportes, "1min", "0", "1min", "on"},
		{"migración", topesDeLaMigracion, "10min", "10s", "1min", "off"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			pool, err := base.PoolCon(ctx, c.topes)
			if err != nil {
				t.Fatal(err)
			}
			defer pool.Close()
			for parametro, quiero := range map[string]string{
				"statement_timeout": c.sentencia, "lock_timeout": c.candado,
				"idle_in_transaction_session_timeout": c.ociosa, "default_transaction_read_only": c.soloLectura,
			} {
				var v string
				if err := pool.QueryRow(ctx, "SHOW "+parametro).Scan(&v); err != nil {
					t.Fatal(err)
				}
				if v != quiero {
					t.Errorf("%s = %s, quería %s", parametro, v, quiero)
				}
			}
			_, err = pool.Exec(ctx, `CREATE TEMP TABLE prueba_escritura (x int)`)
			var pgErr *pgconn.PgError
			soloLectura := errors.As(err, &pgErr) && pgErr.Code == "25006"
			if soloLectura != (c.soloLectura == "on") {
				t.Errorf("escribir dio %v", err)
			}
		})
	}

	// Un candado de sesión se espera sin tope, y la conexión vuelve al pool
	// con los suyos.
	pool, err := base.PoolCon(ctx, plataforma.Topes{Maximo: 1, Sentencia: topesDeLaAPI.Sentencia, Candado: topesDeLaAPI.Candado})
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	restaurar, err := plataforma.SinTopes(ctx, conn)
	if err != nil {
		t.Fatal(err)
	}
	var durante, despues string
	_ = conn.QueryRow(ctx, "SHOW statement_timeout").Scan(&durante)
	restaurar()
	_ = conn.QueryRow(ctx, "SHOW statement_timeout").Scan(&despues)
	conn.Release()
	if durante != "0" || despues != "30s" {
		t.Errorf("durante %s, después %s", durante, despues)
	}
	// Una consulta que pasa el tope se corta.
	corto, err := base.PoolCon(ctx, plataforma.Topes{Maximo: 1, Sentencia: 50 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer corto.Close()
	var pgErr *pgconn.PgError
	if _, err := corto.Exec(ctx, `SELECT pg_sleep(1)`); !errors.As(err, &pgErr) || pgErr.Code != "57014" {
		t.Errorf("la consulta larga no se cortó: %v", err)
	}
}
