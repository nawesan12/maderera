package migracion

import (
	"context"
	"encoding/binary"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"mjbj/internal/fotos"
	"mjbj/internal/subidas"
)

// Importar el 4145 le pone su foto (y su detalle) a la medida nueva;
// reimportar no la duplica, y si la clienta la borró, reimportar no la
// devuelve: el enganche es solo al crear la medida. Un rubro que el
// importador crea sale con su portada.
func TestImportarEngancheLaFoto(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	biblioteca := t.TempDir()
	cab := []byte("RIFF\x00\x00\x00\x00WEBPVP8L\x00\x00\x00\x00\x2f")
	cab = binary.LittleEndian.AppendUint32(cab, uint32(1919)|uint32(1439)<<14)
	for _, a := range []string{"4145.webp", "4145-veta.webp"} {
		if err := os.WriteFile(filepath.Join(biblioteca, a), cab, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	b := fotos.Nueva(fotos.Config{Carpeta: biblioteca}, subidas.Nuevo(subidas.Config{Carpeta: t.TempDir()}),
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	op := Opciones{LoteID: "00000000-0000-0000-0000-000000000000", Fotos: b}

	prod, _ := DefinicionDe("productos")
	columnas := []string{"Código", "Descripción", "Rubro", "Medida"}
	m := Automapear(prod, columnas)
	filas := func() []Fila {
		return NormalizarFilas(prod, m, [][]string{
			{"4145", "Enchapado guatambú", "Placas", "18 mm"},
			{"SINFOTO", "Fenólico", "Placas", "18 mm"},
		})
	}
	r, err := AplicarLote(ctx, e.pool, "productos", filas(), op)
	if err != nil || r.Creados != 2 || r.Fotos != 2 {
		t.Fatalf("primera: %+v %v", r, err)
	}
	contar := func() int {
		var n int
		if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM product_images i JOIN product_variants v ON v.product_id = i.product_id
			WHERE v.sku = '4145'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := contar(); n != 2 {
		t.Fatalf("fotos del 4145: %d", n)
	}
	var portada *string
	if err := e.pool.QueryRow(ctx, `SELECT image FROM categories WHERE slug = 'placas'`).Scan(&portada); err != nil || portada == nil || *portada != "/sitio/placas-v1.webp" {
		t.Errorf("el rubro creado por el importador no tiene su portada: %v %v", portada, err)
	}

	if r, err := AplicarLote(ctx, e.pool, "productos", filas(), op); err != nil || r.Fotos != 0 || contar() != 2 {
		t.Fatalf("reimportar duplicó: %+v %v (%d)", r, err, contar())
	}
	// La clienta borra las dos y reimporta: no vuelven.
	if _, err := e.pool.Exec(ctx, `DELETE FROM product_images`); err != nil {
		t.Fatal(err)
	}
	if r, err := AplicarLote(ctx, e.pool, "productos", filas(), op); err != nil || r.Fotos != 0 || contar() != 0 {
		t.Fatalf("volvió la foto borrada: %+v %v", r, err)
	}
}
