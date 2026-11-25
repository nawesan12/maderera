package db_test

import (
	"context"
	"io/fs"
	"strings"
	"testing"

	"mjbj/db"
	"mjbj/internal/pruebas"
)

// La 00150 borra de los productos las fotos de banco (hallazgo 25). Se prueba
// sobre datos: borra solo esas, deja lo subido, guarda copia, encola el aviso
// para Next y el Down devuelve todo como estaba.
//
// La base de prueba ya pasó por la migración (vacía); acá se corren a mano
// las sentencias de su Up y su Down sobre una base con fotos.
func TestMigracion00150(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	crudo, err := fs.ReadFile(db.Migraciones, "migraciones/00150_fotos_de_rubro_fuera_de_producto.sql")
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

	var cat, prod string
	_ = pool.QueryRow(ctx, `insert into categories (slug, name, description) values ('placas', 'Placas', '') returning id`).Scan(&cat)
	_ = pool.QueryRow(ctx, `insert into products (slug, name, category_id, description) values ('fenolico', 'Fenólico', $1, '') returning id`, cat).Scan(&prod)
	if _, err := pool.Exec(ctx, `insert into product_images (product_id, url, sort_order) values
		($1, '/fotos/photo-1700973408133-b45276ec8feb.jpg', 0),
		($1, '/subidas/fenolico-real.jpg', 1),
		($1, '/fotos/photo-1422246654994-34520d5a0340.jpg', 2)`, prod); err != nil {
		t.Fatal(err)
	}
	contar := func(consulta string) (n int) {
		t.Helper()
		if err := pool.QueryRow(ctx, consulta).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	trabajosAntes := contar(`select count(*) from trabajos where tipo = 'next.revalidar'`)

	correr(up)
	var queda string
	_ = pool.QueryRow(ctx, `select url from product_images where product_id = $1 order by sort_order limit 1`, prod).Scan(&queda)
	if queda != "/subidas/fenolico-real.jpg" || contar(`select count(*) from product_images`) != 1 {
		t.Errorf("después del Up la foto principal es %q y quedan %d", queda, contar(`select count(*) from product_images`))
	}
	if n := contar(`select count(*) from product_images_rubro_00150`); n != 2 {
		t.Errorf("la copia tiene %d filas", n)
	}
	if n := contar(`select count(*) from trabajos where tipo = 'next.revalidar' and carga->'etiquetas' ? 'catalogo'`); n != trabajosAntes+1 {
		t.Errorf("no quedó el aviso para Next: %d", n)
	}

	correr(down)
	if n := contar(`select count(*) from product_images`); n != 3 {
		t.Errorf("después del Down hay %d fotos", n)
	}
	_ = pool.QueryRow(ctx, `select url from product_images where product_id = $1 order by sort_order limit 1`, prod).Scan(&queda)
	if queda != "/fotos/photo-1700973408133-b45276ec8feb.jpg" {
		t.Errorf("el Down no devolvió el orden: %q", queda)
	}
	if n := contar(`select count(*) from pg_tables where tablename = 'product_images_rubro_00150'`); n != 0 {
		t.Errorf("la copia sigue después del Down")
	}
}
