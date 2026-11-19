package db_test

import (
	"context"
	"io/fs"
	"strings"
	"testing"

	"mjbj/db"
	"mjbj/internal/pruebas"
)

// La 00180 saca la portada de banco de Ferretería y Cubiertas (comité final,
// M18), pero no la que subió la clienta ni la de los otros rubros, y el Down
// la devuelve.
func TestMigracion00180(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	crudo, err := fs.ReadFile(db.Migraciones, "migraciones/00180_portadas_de_banco_fuera.sql")
	if err != nil {
		t.Fatal(err)
	}
	texto := string(crudo)
	up, down, _ := strings.Cut(texto[strings.Index(texto, "-- +goose Up"):], "-- +goose Down")
	correr := func(seccion string) {
		t.Helper()
		for _, bloque := range strings.Split(seccion, "-- +goose StatementBegin")[1:] {
			sentencia, _, _ := strings.Cut(bloque, "-- +goose StatementEnd")
			if _, err := pool.Exec(ctx, sentencia); err != nil {
				t.Fatalf("%v\n%s", err, sentencia)
			}
		}
	}
	if _, err := pool.Exec(ctx, `insert into categories (slug, name, image) values
		('ferreteria', 'Ferretería', '/fotos/photo-1558618666-fcd25c85cd64.jpg'),
		('cubiertas', 'Cubiertas', '/subidas/cubiertas-del-deposito.jpg'),
		('placas', 'Placas', '/fotos/photo-1700973408133-b45276ec8feb.jpg')`); err != nil {
		t.Fatal(err)
	}
	imagen := func(slug string) string {
		t.Helper()
		var i *string
		if err := pool.QueryRow(ctx, `select image from categories where slug = $1`, slug).Scan(&i); err != nil {
			t.Fatal(err)
		}
		if i == nil {
			return ""
		}
		return *i
	}
	var antes, despues int
	_ = pool.QueryRow(ctx, `select count(*) from trabajos where tipo = 'next.revalidar'`).Scan(&antes)
	correr(up)
	if imagen("ferreteria") != "" || imagen("cubiertas") != "/subidas/cubiertas-del-deposito.jpg" ||
		imagen("placas") != "/fotos/photo-1700973408133-b45276ec8feb.jpg" {
		t.Errorf("después del Up: %q %q %q", imagen("ferreteria"), imagen("cubiertas"), imagen("placas"))
	}
	_ = pool.QueryRow(ctx, `select count(*) from trabajos where tipo = 'next.revalidar'`).Scan(&despues)
	if despues != antes+1 {
		t.Errorf("no quedó el aviso para Next: %d → %d", antes, despues)
	}
	correr(down)
	if imagen("ferreteria") != "/fotos/photo-1558618666-fcd25c85cd64.jpg" || imagen("cubiertas") != "/subidas/cubiertas-del-deposito.jpg" {
		t.Errorf("después del Down: %q %q", imagen("ferreteria"), imagen("cubiertas"))
	}
}
