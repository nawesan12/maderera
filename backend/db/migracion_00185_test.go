package db_test

import (
	"context"
	"io/fs"
	"strings"
	"testing"

	"mjbj/db"
	"mjbj/internal/pruebas"
)

// La 00185 pone las portadas propias donde había una de banco (y en
// ferretería vacía, como la dejó la 00180), no toca la que subió la clienta
// ni la que sacó a propósito, no le avisa a Next (lo consumía la versión
// anterior) y el Down devuelve las de antes.
func TestMigracion00185(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	crudo, err := fs.ReadFile(db.Migraciones, "migraciones/00185_portadas_propias.sql")
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
	avisos := func() int {
		var n int
		_ = pool.QueryRow(ctx, `select count(*) from trabajos where tipo = 'next.revalidar'`).Scan(&n)
		return n
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

	antes := avisos()
	correr(up)

	if _, err := pool.Exec(ctx, `insert into categories (slug, name, image) values
		('placas', 'Placas', '/fotos/photo-1700973408133-b45276ec8feb.jpg'),
		('ferreteria', 'Ferretería', null),
		('construccion-en-seco', 'Construcción en seco', '/subidas/seco-del-deposito.jpg'),
		('molduras', 'Molduras', '/fotos/photo-1764283824453-02cd00e49143.jpg'),
		('techos', 'Techos', '/fotos/photo-1776624383828-e1bf5d141aa7.jpg')`); err != nil {
		t.Fatal(err)
	}
	correr(up)
	if imagen("placas") != "/sitio/placas-v1.webp" || imagen("ferreteria") != "/sitio/ferreteria-v1.webp" ||
		imagen("construccion-en-seco") != "/subidas/seco-del-deposito.jpg" || imagen("molduras") != "/sitio/molduras-v1.webp" ||
		imagen("techos") != "/fotos/photo-1776624383828-e1bf5d141aa7.jpg" {
		t.Errorf("después del Up: %q %q %q %q %q", imagen("placas"), imagen("ferreteria"),
			imagen("construccion-en-seco"), imagen("molduras"), imagen("techos"))
	}
	if avisos() != antes {
		t.Error("encoló un aviso para Next: lo consume la versión anterior, que no tiene las fotos")
	}
	// Una portada vacía que no es la de ferretería es una que la clienta sacó.
	if _, err := pool.Exec(ctx, `update categories set image = null where slug = 'placas'`); err != nil {
		t.Fatal(err)
	}
	correr(up)
	if imagen("placas") != "" {
		t.Errorf("pisó una portada que la clienta sacó: %q", imagen("placas"))
	}
	if _, err := pool.Exec(ctx, `update categories set image = '/sitio/placas-v1.webp' where slug = 'placas'`); err != nil {
		t.Fatal(err)
	}

	correr(down)
	if imagen("placas") != "/fotos/photo-1700973408133-b45276ec8feb.jpg" || imagen("ferreteria") != "" ||
		imagen("construccion-en-seco") != "/subidas/seco-del-deposito.jpg" ||
		imagen("molduras") != "/fotos/photo-1764283824453-02cd00e49143.jpg" {
		t.Errorf("después del Down: %q %q %q %q", imagen("placas"), imagen("ferreteria"),
			imagen("construccion-en-seco"), imagen("molduras"))
	}
}
