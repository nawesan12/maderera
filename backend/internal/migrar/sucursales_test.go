package migrar_test

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"

	"mjbj/db"
	"mjbj/internal/migrar"
	"mjbj/internal/pruebas"
)

// La 00204 deja las dos sucursales en una base recién migrada (comité del
// 25/11: la base vacía quedaba con «0 locales»), y en una que ya las tiene no
// toca nada ni las duplica. La plantilla de pruebas las borra
// (pruebas.migrarPlantilla): acá se vuelve a correr la migración sola.
func TestLasDosSucursales(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	base := stdlib.OpenDBFromPool(pool)
	defer base.Close()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	correrLa204 := func() {
		t.Helper()
		if _, err := pool.Exec(ctx, `DELETE FROM goose_db_version WHERE version_id = 204`); err != nil {
			t.Fatal(err)
		}
		if _, err := migrar.Correr(ctx, base, db.Migraciones, log); err != nil {
			t.Fatal(err)
		}
	}
	sucursales := func() string {
		t.Helper()
		var s string
		if err := pool.QueryRow(ctx, `SELECT coalesce(string_agg(slug || ':' || name, ',' ORDER BY sort_order, slug), '') FROM branches`).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}

	correrLa204()
	if s := sucursales(); s != "casa-central:Casa Central,aserradero:Aserradero" {
		t.Fatalf("base nueva: %q", s)
	}
	// Una base que ya tenía la suya, con otro nombre: no se pisa ni se duplica.
	if _, err := pool.Exec(ctx, `DELETE FROM branches; INSERT INTO branches (slug, name, sort_order) VALUES ('casa-central', 'Central (sembrada)', 0)`); err != nil {
		t.Fatal(err)
	}
	correrLa204()
	if s := sucursales(); s != "casa-central:Central (sembrada),aserradero:Aserradero" {
		t.Fatalf("base con una ya cargada: %q", s)
	}
}
