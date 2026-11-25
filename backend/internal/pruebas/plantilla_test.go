package pruebas

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"

	"mjbj/db"
)

// Una plantilla que quedó mal —una migración salteada que ya no se puede
// aplicar encima, o una versión que migró otra rama— se borra y se arma de
// nuevo sola, sin que nadie tenga que entrar a borrarla a mano.
func TestLaPlantillaSeRearmaSola(t *testing.T) {
	servidor := os.Getenv("MJBJ_PRUEBA_BASE")
	if servidor == "" {
		t.Skip("sin MJBJ_PRUEBA_BASE")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, conBase(servidor, "postgres"))
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(ctx)
	var b [4]byte
	_, _ = rand.Read(b[:])
	nombre := "t_plantilla_" + hex.EncodeToString(b[:])
	t.Cleanup(func() { _, _ = admin.Exec(context.Background(), `drop database if exists `+nombre+` with (force)`) })

	if err := PrepararPlantilla(ctx, admin, servidor, nombre, db.Migraciones); err != nil {
		t.Fatalf("la primera vez: %v", err)
	}
	enLaPlantilla := func(sql string) {
		t.Helper()
		c, err := pgx.Connect(ctx, conBase(servidor, nombre))
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close(ctx)
		if _, err := c.Exec(ctx, sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	vale := func() {
		t.Helper()
		c, err := pgx.Connect(ctx, conBase(servidor, nombre))
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close(ctx)
		var ajenas, sinAplicar int
		if err := c.QueryRow(ctx, `select count(*) filter (where version_id >= 99000), 190 - max(version_id) from goose_db_version`).Scan(&ajenas, &sinAplicar); err != nil {
			t.Fatal(err)
		}
		if ajenas != 0 || sinAplicar > 0 {
			t.Errorf("la plantilla quedó con %d versiones ajenas y le faltan %d", ajenas, sinAplicar)
		}
	}

	// La 00190 salteada: el esquema la tiene, goose no, y volver a
	// aplicarla da «column already exists».
	enLaPlantilla(`delete from goose_db_version where version_id = 190`)
	if err := PrepararPlantilla(ctx, admin, servidor, nombre, db.Migraciones); err != nil {
		t.Fatalf("con una migración salteada: %v", err)
	}
	vale()

	// Una versión que esta rama no tiene, con su columna.
	enLaPlantilla(`alter table customers add column de_otra_rama int; insert into goose_db_version (version_id, is_applied) values (99001, true)`)
	if err := PrepararPlantilla(ctx, admin, servidor, nombre, db.Migraciones); err != nil {
		t.Fatalf("con una versión ajena: %v", err)
	}
	vale()
	c, err := pgx.Connect(ctx, conBase(servidor, nombre))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(ctx)
	var queda bool
	_ = c.QueryRow(ctx, `select exists(select 1 from information_schema.columns where table_name = 'customers' and column_name = 'de_otra_rama')`).Scan(&queda)
	if queda {
		t.Error("la columna de la otra rama sigue en la plantilla")
	}
}
