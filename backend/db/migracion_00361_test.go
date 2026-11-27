package db_test

import (
	"context"
	"io/fs"
	"strings"
	"testing"

	"mjbj/db"
	"mjbj/internal/pruebas"
)

// La 00361 deja los regímenes como los decidió la clienta: agrega los de IIBB
// que falten, no duplica los que están, y pone en cero los nacionales que
// nadie tocó desde la pantalla. El que el admin cambió a propósito queda
// (mes simulado, M2S1-002).
func TestMigracion00361(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	crudo, err := fs.ReadFile(db.Migraciones, "migraciones/00361_regimenes_de_la_clienta.sql")
	if err != nil {
		t.Fatal(err)
	}
	texto := string(crudo)
	up, _, _ := strings.Cut(texto[strings.Index(texto, "-- +goose Up"):], "-- +goose Down")

	var tocado string
	if err := pool.QueryRow(ctx, `INSERT INTO regimenes_retencion (codigo, nombre, impuesto, alicuota, alicuota_no_inscripto, minimo_no_imponible)
		VALUES ('78', 'Ganancias · compra de bienes', 'ganancias', 2, 28, 224000),
		       ('499', 'IVA · compra de bienes', 'iva', 8.68, 10.5, 0),
		       ('SUSS', 'SUSS', 'suss', 1.2, 1.2, 0) RETURNING id`).Scan(&tocado); err != nil {
		t.Fatal(err)
	}
	var suss string
	if err := pool.QueryRow(ctx, `SELECT id FROM regimenes_retencion WHERE codigo = 'SUSS'`).Scan(&suss); err != nil {
		t.Fatal(err)
	}
	// El SUSS lo dejó al 1,2 % el admin, desde la pantalla.
	if _, err := pool.Exec(ctx, `INSERT INTO audit_log (usuario_nombre, accion, entidad, entidad_id, descripcion)
		VALUES ('Dueña', 'editar', 'retencion', $1, 'Dejó SUSS al 1.2%')`, suss); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := pool.Exec(ctx, up); err != nil {
			t.Fatal(err)
		}
	}
	filas, err := pool.Query(ctx, `SELECT codigo, alicuota::text FROM regimenes_retencion ORDER BY codigo`)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for filas.Next() {
		var c, a string
		if err := filas.Scan(&c, &a); err != nil {
			t.Fatal(err)
		}
		got = append(got, c+"="+a)
	}
	want := "499=0.000 78=0.000 94=0.000 IIBB-BA=0.000 IIBB-MI=1.500 SUSS=1.200"
	if strings.Join(got, " ") != want {
		t.Fatalf("regímenes: %v, quería %s", got, want)
	}
}
