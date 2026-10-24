// Package migrar aplica las migraciones de goose, y la primera vez adopta
// una base que venía migrando drizzle.
package migrar

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"log/slog"

	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/database"
)

// Cuántas migraciones tuvo drizzle antes de congelarse: 0000–0078.
const migracionesDeDrizzle = 79

const tablaGoose = "goose_db_version"

// Correr adopta (si hace falta) y aplica lo pendiente. Devuelve la versión en
// la que queda la base.
func Correr(ctx context.Context, base *sql.DB, migraciones fs.FS, log *slog.Logger) (int64, error) {
	sub, err := fs.Sub(migraciones, "migraciones")
	if err != nil {
		return 0, err
	}
	if err := adoptar(ctx, base, log); err != nil {
		return 0, fmt.Errorf("adoptando la base de drizzle: %w", err)
	}
	p, err := goose.NewProvider(goose.DialectPostgres, base, sub)
	if err != nil {
		return 0, err
	}
	resultados, err := p.Up(ctx)
	for _, r := range resultados {
		log.Info("migración aplicada", "version", r.Source.Version, "archivo", r.Source.Path, "ms", r.Duration.Milliseconds())
	}
	if err != nil {
		return 0, err
	}
	return p.GetDBVersion(ctx)
}

// adoptar pasa a goose una base que migraba drizzle-kit: anota en la tabla de
// goose las migraciones que drizzle ya aplicó, para que goose siga desde la
// siguiente y no las vuelva a correr.
//
// Drizzle las aplica en orden y anota una fila por migración en
// `drizzle.__drizzle_migrations`; la N-ésima de drizzle es la versión N de
// goose (ver db/convertir-drizzle.py). Si la base tiene menos de 79, se
// anotan las que tiene y goose aplica el resto.
//
// Una base vacía no tiene nada que adoptar: goose corre todo desde la 1.
func adoptar(ctx context.Context, base *sql.DB, log *slog.Logger) error {
	var tieneGoose, tieneDrizzle bool
	if err := base.QueryRowContext(ctx, `select to_regclass('public.goose_db_version') is not null,
		to_regclass('drizzle.__drizzle_migrations') is not null`).Scan(&tieneGoose, &tieneDrizzle); err != nil {
		return err
	}
	if tieneGoose || !tieneDrizzle {
		return nil
	}
	var aplicadas int64
	if err := base.QueryRowContext(ctx, `select count(*) from drizzle.__drizzle_migrations`).Scan(&aplicadas); err != nil {
		return err
	}
	if aplicadas > migracionesDeDrizzle {
		return fmt.Errorf("drizzle tiene %d migraciones y se congeló en %d: hay una migración de drizzle que goose no conoce", aplicadas, migracionesDeDrizzle)
	}
	store, err := database.NewStore(database.DialectPostgres, tablaGoose)
	if err != nil {
		return err
	}
	tx, err := base.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := store.CreateVersionTable(ctx, tx); err != nil {
		return err
	}
	// La versión 0 es la que goose anota al crear su tabla.
	if err := store.Insert(ctx, tx, database.InsertRequest{Version: 0}); err != nil {
		return err
	}
	for v := int64(1); v <= aplicadas; v++ {
		if err := store.Insert(ctx, tx, database.InsertRequest{Version: v}); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	log.Info("base adoptada de drizzle", "migraciones", aplicadas)
	return nil
}
