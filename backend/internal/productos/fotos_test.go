package productos

import (
	"context"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/fotos"
	"mjbj/internal/subidas"
)

// Una medida nueva con código de la biblioteca se lleva su foto al guardar la
// ficha. Si la clienta la borra y vuelve a guardar, no vuelve: el enganche es
// solo al crear la medida.
func TestLaMedidaNuevaSeLlevaSuFoto(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	e.staff(t, "admin@prueba.test", "admin")
	var usuario string
	if err := e.pool.QueryRow(ctx, `select id from "user" where email = 'admin@prueba.test'`).Scan(&usuario); err != nil {
		t.Fatal(err)
	}
	ses := &auth.Sesion{UserID: usuario, Nombre: "Persona"}

	biblioteca := t.TempDir()
	cab := []byte("RIFF\x00\x00\x00\x00WEBPVP8L\x00\x00\x00\x00\x2f")
	cab = binary.LittleEndian.AppendUint32(cab, uint32(1919)|uint32(1439)<<14)
	if err := os.WriteFile(filepath.Join(biblioteca, "392.webp"), cab, 0o644); err != nil {
		t.Fatal(err)
	}
	disco := subidas.Nuevo(subidas.Config{Carpeta: t.TempDir()})
	s := Nuevo(e.pool, disco, silencio).ConFotos(fotos.Nueva(fotos.Config{Carpeta: biblioteca}, disco, silencio))

	ficha := FormProducto{Name: "Chapadur marrón", Slug: "chapadur-marron", CategoryID: e.cat, Unit: "placa",
		FormaDeVenta: "entera", PrecioMediaPct: "50", AlicuotaIva: "21", Active: true,
		Variantes: []FormVariante{{SKU: "392", Label: "3 mm", PrecioGeneral: "1000", StockCentral: "1", StockAserradero: "0"}}}
	id, err := s.Guardar(ctx, ses, ficha)
	if err != nil {
		t.Fatal(err)
	}
	fotosDe := func() int {
		var n int
		if err := e.pool.QueryRow(ctx, `select count(*) from product_images where product_id = $1 and origen_biblioteca = '392.webp'`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if fotosDe() != 1 {
		t.Fatal("la medida nueva no se llevó su foto")
	}

	// Borrada a propósito, guardar de nuevo (la medida ya existe) no la devuelve.
	if _, err := e.pool.Exec(ctx, `delete from product_images where product_id = $1`, id); err != nil {
		t.Fatal(err)
	}
	var variante string
	if err := e.pool.QueryRow(ctx, `select id from product_variants where product_id = $1`, id).Scan(&variante); err != nil {
		t.Fatal(err)
	}
	ficha.ID = id
	ficha.Variantes[0].ID = variante
	if _, err := s.Guardar(ctx, ses, ficha); err != nil {
		t.Fatal(err)
	}
	if fotosDe() != 0 {
		t.Error("volvió la foto que la clienta borró")
	}
}

// Borrar la foto desde el panel la anota como descartada: si la medida se
// borra y se vuelve a cargar con el mismo código, la foto no vuelve.
func TestFotoBorradaDesdeElPanelNoVuelve(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	e.staff(t, "admin@prueba.test", "admin")
	var usuario string
	if err := e.pool.QueryRow(ctx, `select id from "user" where email = 'admin@prueba.test'`).Scan(&usuario); err != nil {
		t.Fatal(err)
	}
	ses := &auth.Sesion{UserID: usuario, Nombre: "Persona"}
	biblioteca := t.TempDir()
	cab := []byte("RIFF\x00\x00\x00\x00WEBPVP8L\x00\x00\x00\x00\x2f")
	cab = binary.LittleEndian.AppendUint32(cab, uint32(1919)|uint32(1439)<<14)
	if err := os.WriteFile(filepath.Join(biblioteca, "392.webp"), cab, 0o644); err != nil {
		t.Fatal(err)
	}
	disco := subidas.Nuevo(subidas.Config{Carpeta: t.TempDir()})
	b := fotos.Nueva(fotos.Config{Carpeta: biblioteca}, disco, silencio)
	s := Nuevo(e.pool, disco, silencio).ConFotos(b)
	ficha := FormProducto{Name: "Chapadur marrón", Slug: "chapadur-marron", CategoryID: e.cat, Unit: "placa",
		FormaDeVenta: "entera", PrecioMediaPct: "50", AlicuotaIva: "21", Active: true,
		Variantes: []FormVariante{{SKU: "392", Label: "3 mm", PrecioGeneral: "1000", StockCentral: "1", StockAserradero: "0"}}}
	id, err := s.Guardar(ctx, ses, ficha)
	if err != nil {
		t.Fatal(err)
	}
	var foto string
	if err := e.pool.QueryRow(ctx, `select id from product_images where product_id = $1`, id).Scan(&foto); err != nil {
		t.Fatal(err)
	}
	if _, err := s.BorrarImagen(ctx, foto); err != nil {
		t.Fatal(err)
	}
	if n := b.Adjuntar(ctx, e.pool, fotos.Medida{ProductoID: id, Codigo: "392"}); n != 0 {
		t.Errorf("la foto borrada desde el panel volvió: %d", n)
	}
}
