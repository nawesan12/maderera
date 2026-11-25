package migrar_test

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"

	"mjbj/db"
	"mjbj/internal/migrar"
	"mjbj/internal/pruebas"
)

// La 00168 cortada a mitad: el índice que se estaba armando queda inválido.
// Al volver a correrla, se borra y se arma de nuevo, en vez de quedar
// salteado para siempre por el IF NOT EXISTS. Y si queda uno inválido que
// ninguna migración rehace, `mjbj migrar` falla a la vista.
func TestIndiceInvalidoSeRehace(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	base := stdlib.OpenDBFromPool(pool)
	defer base.Close()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	valido := func(nombre string) bool {
		var v bool
		if err := pool.QueryRow(ctx, `SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass($1)`, nombre).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}

	// Como lo deja un CONCURRENTLY cortado: el nombre existe, inválido, y
	// goose no anotó la migración.
	if _, err := pool.Exec(ctx, `UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'account_movements_cliente_fecha_idx'::regclass`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM goose_db_version WHERE version_id = 168`); err != nil {
		t.Fatal(err)
	}
	if _, err := migrar.Correr(ctx, base, db.Migraciones, log); err != nil {
		t.Fatalf("volver a correr la 00168: %v", err)
	}
	if !valido("account_movements_cliente_fecha_idx") {
		t.Error("el índice sigue inválido después de volver a correr la migración")
	}

	// Uno que ninguna migración pendiente rehace: error, con el nombre.
	if _, err := pool.Exec(ctx, `UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'customers_updated_idx'::regclass`); err != nil {
		t.Fatal(err)
	}
	_, err := migrar.Correr(ctx, base, db.Migraciones, log)
	if err == nil || !strings.Contains(err.Error(), "customers_updated_idx") {
		t.Errorf("con un índice inválido, migrar dio %v", err)
	}
}
