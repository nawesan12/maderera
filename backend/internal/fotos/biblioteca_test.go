package fotos_test

import (
	"context"
	"encoding/binary"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/fotos"
	"mjbj/internal/pruebas"
	"mjbj/internal/subidas"
)

// webp arma la cabecera de un WebP sin pérdida (VP8L) de esas medidas, con
// relleno: alcanza para la firma de subidas y para MedidasWebP.
func webp(ancho, alto, relleno int) []byte {
	b := []byte("RIFF\x00\x00\x00\x00WEBPVP8L\x00\x00\x00\x00\x2f")
	v := uint32(ancho-1) | uint32(alto-1)<<14
	b = binary.LittleEndian.AppendUint32(b, v)
	return append(b, make([]byte, relleno)...)
}

func TestListaSinRepetidos(t *testing.T) {
	codigos, archivos := map[string]bool{}, map[string]bool{}
	for _, e := range fotos.Lista {
		if len(e.Archivos) == 0 || len(e.Codigos) == 0 {
			t.Errorf("entrada incompleta: %+v", e)
		}
		for _, c := range e.Codigos {
			if codigos[strings.ToLower(c)] {
				t.Errorf("el código %s está dos veces: una medida tendría dos fotos distintas según el orden", c)
			}
			codigos[strings.ToLower(c)] = true
		}
		for _, a := range e.Archivos {
			if archivos[a] {
				t.Errorf("el archivo %s está dos veces", a)
			}
			archivos[a] = true
			if !strings.HasSuffix(a, ".webp") || a != strings.ToLower(a) || strings.ContainsAny(a, " /") {
				t.Errorf("%s: los nombres van en minúscula, sin espacios y en .webp", a)
			}
		}
	}
	if e, ok := fotos.DeCodigo(" 12851 "); !ok || e.Archivos[0] != "12850-12851.webp" {
		t.Errorf("12851 tiene que dar la foto compartida: %+v %v", e, ok)
	}
}

func TestMedidasWebP(t *testing.T) {
	if w, h, err := fotos.MedidasWebP(webp(1920, 1440, 0)); err != nil || w != 1920 || h != 1440 {
		t.Errorf("VP8L: %d×%d %v", w, h, err)
	}
	// VP8 con pérdida: lo que saca sharp.
	vp8 := []byte("RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00\x00\x00\x00\x9d\x01\x2a")
	vp8 = binary.LittleEndian.AppendUint16(vp8, 2000)
	vp8 = binary.LittleEndian.AppendUint16(vp8, 1500)
	if w, h, err := fotos.MedidasWebP(vp8); err != nil || w != 2000 || h != 1500 {
		t.Errorf("VP8: %d×%d %v", w, h, err)
	}
	vp8x := []byte("RIFF\x00\x00\x00\x00WEBPVP8X\x00\x00\x00\x00\x00\x00\x00\x00")
	vp8x = append(vp8x, 0x7f, 0x07, 0x00, 0x9f, 0x05, 0x00) // 1919+1, 1439+1
	if w, h, err := fotos.MedidasWebP(vp8x); err != nil || w != 1920 || h != 1440 {
		t.Errorf("VP8X: %d×%d %v", w, h, err)
	}
	if _, _, err := fotos.MedidasWebP([]byte("\xff\xd8\xff un jpeg cualquiera de más de treinta bytes")); err == nil {
		t.Error("un JPEG pasó por WebP")
	}
}

func TestCargarRevisaYEsTodoONada(t *testing.T) {
	origen, destino := t.TempDir(), t.TempDir()
	b := fotos.Nueva(fotos.Config{Carpeta: destino}, subidas.Nuevo(subidas.Config{Carpeta: t.TempDir()}), slog.New(slog.NewTextHandler(io.Discard, nil)))
	escribir := func(n string, d []byte) {
		if err := os.WriteFile(filepath.Join(origen, n), d, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	escribir("392.webp", webp(1920, 1440, 100))
	escribir("4145-veta.webp", webp(1500, 1125, 100)) // el detalle va sin agrandar: alcanza con 1400
	escribir("391.webp", webp(640, 480, 100))         // chica: de borde a borde se ve borrosa
	escribir("otra.webp", webp(1920, 1440, 100))

	c, err := b.Cargar(origen)
	if err == nil || !strings.Contains(c.Rechazado["391.webp"], "640×480") {
		t.Fatalf("la chica tenía que rechazarse: %+v %v", c, err)
	}
	if entradas, _ := os.ReadDir(destino); len(entradas) != 0 {
		t.Errorf("con una rechazada no se copia ninguna: %d", len(entradas))
	}

	escribir("391.webp", []byte("no soy un webp, soy un texto con más de treinta bytes"))
	if c, _ := b.Cargar(origen); c.Rechazado["391.webp"] != "no es un WebP" {
		t.Errorf("un archivo que no es WebP: %+v", c.Rechazado)
	}

	if err := os.Remove(filepath.Join(origen, "391.webp")); err != nil {
		t.Fatal(err)
	}
	c, err = b.Cargar(origen)
	if err != nil || len(c.Copiados) != 2 {
		t.Fatalf("%+v %v", c, err)
	}
	if len(c.Sobran) != 1 || c.Sobran[0] != "otra.webp" {
		t.Errorf("sobran: %v", c.Sobran)
	}
	if len(c.Faltan) != len(fotos.Archivos())-2 {
		t.Errorf("faltan %d, tenían que ser %d", len(c.Faltan), len(fotos.Archivos())-2)
	}
	if _, err := os.Stat(filepath.Join(destino, "otra.webp")); !os.IsNotExist(err) {
		t.Error("copió un archivo que no está en la lista")
	}
}

type entorno struct {
	pool    *pgxpool.Pool
	b       *fotos.Biblioteca
	subidas string
	cat     string
}

func preparar(t *testing.T, archivos ...string) entorno {
	t.Helper()
	pool := pruebas.Base(t)
	biblioteca, pub := t.TempDir(), t.TempDir()
	for _, a := range archivos {
		if err := os.WriteFile(filepath.Join(biblioteca, a), webp(1920, 1440, 64), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	e := entorno{
		pool:    pool,
		b:       fotos.Nueva(fotos.Config{Carpeta: biblioteca}, subidas.Nuevo(subidas.Config{Carpeta: pub}), slog.New(slog.NewTextHandler(io.Discard, nil))),
		subidas: pub,
	}
	if err := pool.QueryRow(context.Background(), `insert into categories (slug, name, description) values ('placas', 'Placas', '') returning id`).Scan(&e.cat); err != nil {
		t.Fatal(err)
	}
	return e
}

func (e entorno) producto(t *testing.T, slug, nombre string, skus ...string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := e.pool.QueryRow(ctx, `insert into products (slug, name, category_id, description) values ($1, $2, $3, '') returning id`, slug, nombre, e.cat).Scan(&id); err != nil {
		t.Fatal(err)
	}
	for _, s := range skus {
		if _, err := e.pool.Exec(ctx, `insert into product_variants (product_id, sku, label) values ($1, $2, $2)`, id, s); err != nil {
			t.Fatal(err)
		}
	}
	return id
}

type foto struct {
	url, alt, origen string
	orden            int
}

func (e entorno) fotosDe(t *testing.T, producto string) []foto {
	t.Helper()
	filas, err := e.pool.Query(context.Background(), `select url, coalesce(alt, ''), coalesce(origen_biblioteca, ''), sort_order
		from product_images where product_id = $1 order by sort_order`, producto)
	if err != nil {
		t.Fatal(err)
	}
	defer filas.Close()
	var fs []foto
	for filas.Next() {
		var f foto
		if err := filas.Scan(&f.url, &f.alt, &f.origen, &f.orden); err != nil {
			t.Fatal(err)
		}
		fs = append(fs, f)
	}
	return fs
}

func (e entorno) archivosPublicos(t *testing.T) int {
	t.Helper()
	entradas, err := os.ReadDir(e.subidas)
	if err != nil {
		t.Fatal(err)
	}
	return len(entradas)
}

// La foto y su detalle, una sola vez aunque se repita, y sin pisar lo que la
// clienta subió a mano.
func TestAdjuntarNoDuplicaNiPisa(t *testing.T) {
	e := preparar(t, "4145.webp", "4145-veta.webp")
	ctx := context.Background()
	p := e.producto(t, "guatambu", "Enchapado guatambú", "4145")
	if _, err := e.pool.Exec(ctx, `insert into product_images (product_id, url, alt, sort_order) values ($1, '/subidas/a-mano.jpg', 'a mano', 0)`, p); err != nil {
		t.Fatal(err)
	}
	if n := e.b.Adjuntar(ctx, e.pool, fotos.Medida{ProductoID: p, Codigo: "4145"}); n != 2 {
		t.Fatalf("puso %d, tenían que ser 2", n)
	}
	if n := e.b.Adjuntar(ctx, e.pool, fotos.Medida{ProductoID: p, Codigo: "4145"}); n != 0 {
		t.Errorf("la segunda vez puso %d", n)
	}
	fs := e.fotosDe(t, p)
	if len(fs) != 3 || fs[0].url != "/subidas/a-mano.jpg" || fs[1].origen != "4145.webp" || fs[2].origen != "4145-veta.webp" {
		t.Fatalf("%+v", fs)
	}
	if fs[1].alt != "Enchapado guatambú" || fs[2].alt != "Enchapado guatambú, de cerca" {
		t.Errorf("textos alternativos: %q %q", fs[1].alt, fs[2].alt)
	}
	if !strings.HasPrefix(fs[1].url, "/subidas/producto-") || !strings.HasSuffix(fs[1].url, ".webp") {
		t.Errorf("url: %s", fs[1].url)
	}
	// La repetición no dejó archivos sueltos: dos fotos, dos archivos.
	if n := e.archivosPublicos(t); n != 2 {
		t.Errorf("hay %d archivos en /subidas, tenían que ser 2", n)
	}
	// Un código que no está en la biblioteca no hace nada.
	if n := e.b.Adjuntar(ctx, e.pool, fotos.Medida{ProductoID: p, Codigo: "99999"}); n != 0 {
		t.Errorf("un código sin foto puso %d", n)
	}
}

// Si falta el archivo, sigue: una importación nunca falla por una foto.
func TestAdjuntarSinArchivo(t *testing.T) {
	e := preparar(t) // la biblioteca vacía
	p := e.producto(t, "chapadur", "Chapadur marrón", "392")
	if n := e.b.Adjuntar(context.Background(), e.pool, fotos.Medida{ProductoID: p, Codigo: "392"}); n != 0 {
		t.Errorf("puso %d sin archivo", n)
	}
	if len(e.fotosDe(t, p)) != 0 || e.archivosPublicos(t) != 0 {
		t.Error("quedó algo")
	}
	var nada *fotos.Biblioteca
	if nada.Adjuntar(context.Background(), e.pool, fotos.Medida{ProductoID: p, Codigo: "392"}) != 0 {
		t.Error("sin biblioteca no hay fotos")
	}
}

// La melamina en aglomerado y en MDF, medidas del mismo producto: cada una
// suma la suya (hallazgo 4 del comité). La foto compartida por dos códigos
// va una sola vez. Cada producto tiene su copia del archivo.
func TestDosMedidasYFotoCompartida(t *testing.T) {
	e := preparar(t, "12724.webp", "4696.webp", "12850-12851.webp")
	ctx := context.Background()
	mel := e.producto(t, "melamina", "Melamina blanca 18 mm", "12724", "4696")
	e.b.Adjuntar(ctx, e.pool, fotos.Medida{ProductoID: mel, Codigo: "12724"})
	e.b.Adjuntar(ctx, e.pool, fotos.Medida{ProductoID: mel, Codigo: "4696"})
	fs := e.fotosDe(t, mel)
	if len(fs) != 2 || fs[0].alt != "Melamina blanca 18 mm, aglomerado" || fs[1].alt != "Melamina blanca 18 mm, MDF" {
		t.Fatalf("%+v", fs)
	}

	euca := e.producto(t, "eucaliptus", "Tablero eucaliptus", "12850", "12851")
	e.b.Adjuntar(ctx, e.pool, fotos.Medida{ProductoID: euca, Codigo: "12850"})
	e.b.Adjuntar(ctx, e.pool, fotos.Medida{ProductoID: euca, Codigo: "12851"})
	if fs := e.fotosDe(t, euca); len(fs) != 1 {
		t.Errorf("la foto compartida quedó %d veces", len(fs))
	}
	// Una copia por producto: borrar la de uno no deja al otro sin foto.
	p2 := e.producto(t, "melamina-otra", "Melamina blanca otra", "X")
	e.b.Adjuntar(ctx, e.pool, fotos.Medida{ProductoID: p2, Codigo: "12724"})
	if a, b := e.fotosDe(t, mel)[0].url, e.fotosDe(t, p2)[0].url; a == b {
		t.Errorf("dos productos comparten el archivo %s", a)
	}
}

// El lote: solo productos sin ninguna foto con una medida de la biblioteca.
func TestSinFoto(t *testing.T) {
	e := preparar(t)
	ctx := context.Background()
	sin := e.producto(t, "chapadur", "Chapadur marrón", "392")
	con := e.producto(t, "perforado", "Chapadur perforado", "391")
	_ = e.producto(t, "otro", "Sin código de la biblioteca", "ABC")
	if _, err := e.pool.Exec(ctx, `insert into product_images (product_id, url) values ($1, '/subidas/x.jpg')`, con); err != nil {
		t.Fatal(err)
	}
	ps, err := fotos.SinFoto(ctx, e.pool)
	if err != nil || len(ps) != 1 || ps[0].ProductoID != sin || ps[0].Codigo != "392" {
		t.Fatalf("%+v %v", ps, err)
	}
}
