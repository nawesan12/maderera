// Package fotos es la biblioteca de fotos de producto por código.
//
// La clienta mandó fotos de estudio con el código MJBJ en el nombre del
// archivo («CHAPADUR MARRON 3MM (392).jpg»). El código es el `sku` de la
// medida. La lista de abajo dice qué archivo va con qué código; los archivos,
// ya procesados (scripts/fotos/procesar.mjs), viven en el volumen privado
// (`CARPETA_BIBLIOTECA`), que Caddy no sirve y que entra en el respaldo.
//
// Cuándo se engancha una foto: **solo cuando se crea una medida** con un
// código de la lista (el importador de ISIS y la ficha del panel), y en lote
// con `mjbj fotos adjuntar` para lo que ya estaba cargado. Nunca al guardar:
// una foto que la clienta borró a propósito no vuelve.
//
// Cada producto recibe **su copia** del archivo en /subidas/: BorrarImagen
// borra el archivo del disco, y si dos productos compartieran uno, borrar la
// foto de uno dejaría al otro sin foto.
package fotos

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/subidas"
)

// Entrada es una foto de la biblioteca: sus archivos (la foto y, si hay, el
// detalle de la veta) y los códigos de las medidas que muestra.
type Entrada struct {
	Archivos []string
	Codigos  []string
	// Soporte se suma al texto alternativo cuando dos medidas del mismo
	// producto se distinguen por él (aglomerado o MDF).
	Soporte string
}

// Lista es la biblioteca. Datos fijos: van en código (la regla del
// proyecto), y una prueba vigila que ningún código aparezca dos veces.
//
// Fuera, hasta que la clienta mande la planilla de archivo y código: las 20
// de ferretería y 12 de placas de estudio sin código. Fuera por chicas (640
// px): los entramados 52010 y 52012 y las 14 de Moldava.
var Lista = []Entrada{
	{Archivos: []string{"392.webp"}, Codigos: []string{"392"}},
	{Archivos: []string{"391.webp"}, Codigos: []string{"391"}},
	{Archivos: []string{"4145.webp", "4145-veta.webp"}, Codigos: []string{"4145"}},
	{Archivos: []string{"4159.webp", "4159-veta.webp"}, Codigos: []string{"4159"}},
	{Archivos: []string{"4147.webp", "4147-veta.webp"}, Codigos: []string{"4147"}},
	{Archivos: []string{"5743.webp"}, Codigos: []string{"5743"}},
	{Archivos: []string{"12724.webp"}, Codigos: []string{"12724"}, Soporte: "aglomerado"},
	{Archivos: []string{"4696.webp"}, Codigos: []string{"4696"}, Soporte: "MDF"},
	{Archivos: []string{"4172.webp"}, Codigos: []string{"4172"}},
	{Archivos: []string{"12848.webp"}, Codigos: []string{"12848"}},
	{Archivos: []string{"12850-12851.webp"}, Codigos: []string{"12850", "12851"}},
	{Archivos: []string{"12801.webp"}, Codigos: []string{"12801"}},
	{Archivos: []string{"9035.webp"}, Codigos: []string{"9035"}},
}

// DeCodigo devuelve la entrada de un código (sin distinguir mayúsculas ni
// espacios alrededor, como el sku).
func DeCodigo(codigo string) (Entrada, bool) {
	c := strings.ToLower(strings.TrimSpace(codigo))
	for _, e := range Lista {
		for _, k := range e.Codigos {
			if strings.ToLower(k) == c {
				return e, true
			}
		}
	}
	return Entrada{}, false
}

// Archivos son todos los nombres de la lista, en orden.
func Archivos() []string {
	var todos []string
	for _, e := range Lista {
		todos = append(todos, e.Archivos...)
	}
	return todos
}

// Config es dónde está la biblioteca.
type Config struct {
	Carpeta string `env:"CARPETA_BIBLIOTECA" envDefault:"/datos/privado/biblioteca"`
}

// Biblioteca lee los archivos y los copia a /subidas/.
type Biblioteca struct {
	carpeta string
	disco   *subidas.Disco
	log     *slog.Logger
}

// Nueva arma la biblioteca.
func Nueva(c Config, disco *subidas.Disco, log *slog.Logger) *Biblioteca {
	return &Biblioteca{carpeta: c.Carpeta, disco: disco, log: log}
}

// Medida es una medida recién creada: el producto y su código.
type Medida struct {
	ProductoID string
	Codigo     string
}

// Adjuntar le pone al producto las fotos de la biblioteca de ese código, las
// que todavía no tenga. Devuelve cuántas puso.
//
// «Las que todavía no tenga» es por archivo de origen (columna
// `origen_biblioteca`, migración 00186), no «si no tiene ninguna foto»: si un
// producto tiene la melamina en aglomerado (12724) y en MDF (4696), cada
// medida suma la suya, y el cliente que compra MDF ve el canto del MDF.
//
// Una foto nunca hace fallar a quien la llama: si falta el archivo, lo anota
// en el registro y sigue. Va después del commit de quien crea la medida (si
// algo se deshace no quedan archivos sueltos) y antes de contestar (la página
// que se vuelve a armar ya la tiene).
func (b *Biblioteca) Adjuntar(ctx context.Context, pool *pgxpool.Pool, m Medida) int {
	if b == nil {
		return 0
	}
	e, ok := DeCodigo(m.Codigo)
	if !ok {
		return 0
	}
	puestas := 0
	for i, archivo := range e.Archivos {
		ok, err := b.adjuntarArchivo(ctx, pool, m.ProductoID, archivo, e.Soporte, i > 0)
		if err != nil {
			b.log.Warn("foto de la biblioteca sin enganchar", "producto", m.ProductoID, "codigo", m.Codigo, "archivo", archivo, "error", err)
			continue
		}
		if ok {
			puestas++
		}
	}
	return puestas
}

// adjuntarArchivo copia un archivo y lo anota. Devuelve false si el producto
// ya lo tenía (o dejó de existir).
func (b *Biblioteca) adjuntarArchivo(ctx context.Context, pool *pgxpool.Pool, productoID, archivo, soporte string, detalle bool) (bool, error) {
	// Antes de leer el disco: lo normal al reimportar es que ya esté.
	var ya bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM product_images WHERE product_id = $1 AND origen_biblioteca = $2)`,
		productoID, archivo).Scan(&ya); err != nil || ya {
		return false, err
	}
	datos, err := os.ReadFile(filepath.Join(b.carpeta, archivo))
	if err != nil {
		return false, err
	}
	url, err := b.disco.GuardarImagen(datos, "image/webp", "producto")
	if err != nil {
		return false, err
	}
	puesta := false
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		// El producto bloqueado: dos lotes, o un lote y la ficha, no se
		// pisan el orden ni duplican la foto.
		var nombre string
		if err := tx.QueryRow(ctx, `SELECT name FROM products WHERE id = $1 FOR UPDATE`, productoID).Scan(&nombre); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		alt := nombre
		if soporte != "" && !strings.Contains(strings.ToLower(nombre), strings.ToLower(soporte)) {
			alt += ", " + soporte
		}
		if detalle {
			alt += ", de cerca"
		}
		tag, err := tx.Exec(ctx, `INSERT INTO product_images (product_id, url, alt, sort_order, origen_biblioteca)
			SELECT $1, $2, $3, coalesce((SELECT max(sort_order) + 1 FROM product_images WHERE product_id = $1), 0), $4
			ON CONFLICT (product_id, origen_biblioteca) WHERE origen_biblioteca IS NOT NULL DO NOTHING`,
			productoID, url, alt, archivo)
		if err != nil {
			return err
		}
		puesta = tag.RowsAffected() == 1
		return nil
	})
	if err != nil || !puesta {
		// La copia no quedó anotada: no se deja un archivo público suelto.
		_ = b.disco.Borrar(url)
	}
	return puesta, err
}

// Pendiente es un producto sin ninguna foto con una medida de la biblioteca.
type Pendiente struct {
	ProductoID string
	Nombre     string
	Codigo     string
}

// SinFoto lista los productos que no tienen ninguna foto y tienen alguna
// medida (activa o no) con un código de la biblioteca. Para el lote: la regla
// de siempre, «sin ninguna foto», así no se le suma nada a lo que la clienta
// ya armó a mano.
func SinFoto(ctx context.Context, pool *pgxpool.Pool) ([]Pendiente, error) {
	var codigos []string
	for _, e := range Lista {
		for _, c := range e.Codigos {
			codigos = append(codigos, strings.ToLower(c))
		}
	}
	filas, err := pool.Query(ctx, `SELECT p.id::text, p.name, v.sku FROM products p
		JOIN product_variants v ON v.product_id = p.id
		WHERE lower(trim(v.sku)) = ANY($1)
		  AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)
		ORDER BY p.name, v.sort_order, v.sku`, codigos)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Pendiente, error) {
		var p Pendiente
		return p, r.Scan(&p.ProductoID, &p.Nombre, &p.Codigo)
	})
}

/* ----------------------------- cargar ----------------------------- */

// TopeArchivo es el de las fotos que se suben desde el panel (subidas).
const TopeArchivo = 8 << 20

// LadoMinimo es la regla de la biblioteca: de borde a borde en el teléfono
// una foto más chica se ve borrosa.
const LadoMinimo = 1600

// LadoMinimoDetalle es el del recorte de la veta: va en píxeles originales,
// sin agrandar.
const LadoMinimoDetalle = 1400

// MedidasWebP lee ancho y alto de la cabecera de un WebP (VP8, VP8L o VP8X)
// sin decodificarlo: la biblioteca estándar de Go no trae WebP y no hace
// falta una dependencia para leer dos números.
func MedidasWebP(b []byte) (ancho, alto int, err error) {
	if len(b) < 25 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WEBP" {
		return 0, 0, errors.New("no es un WebP")
	}
	tipo := string(b[12:16])
	if tipo != "VP8L" && len(b) < 30 {
		return 0, 0, errors.New("WebP cortado")
	}
	switch tipo {
	case "VP8 ":
		if !bytes.Equal(b[23:26], []byte{0x9d, 0x01, 0x2a}) {
			return 0, 0, errors.New("WebP con un marco VP8 inválido")
		}
		return int(binary.LittleEndian.Uint16(b[26:28]) & 0x3fff), int(binary.LittleEndian.Uint16(b[28:30]) & 0x3fff), nil
	case "VP8L":
		if b[20] != 0x2f {
			return 0, 0, errors.New("WebP sin pérdida inválido")
		}
		v := binary.LittleEndian.Uint32(b[21:25])
		return int(v&0x3fff) + 1, int((v>>14)&0x3fff) + 1, nil
	case "VP8X":
		w := int(b[24]) | int(b[25])<<8 | int(b[26])<<16
		h := int(b[27]) | int(b[28])<<8 | int(b[29])<<16
		return w + 1, h + 1, nil
	}
	return 0, 0, errors.New("WebP de un tipo desconocido")
}

// Revisar dice qué tiene de malo un archivo para la biblioteca ("" si nada).
func Revisar(nombre string, datos []byte) string {
	if len(datos) > TopeArchivo {
		return fmt.Sprintf("pesa %.1f MB y el tope es 8 MB", float64(len(datos))/1024/1024)
	}
	w, h, err := MedidasWebP(datos)
	if err != nil {
		return err.Error()
	}
	minimo := LadoMinimo
	if strings.Contains(nombre, "-veta") || strings.Contains(nombre, "-canto") {
		minimo = LadoMinimoDetalle
	}
	if max(w, h) < minimo {
		return fmt.Sprintf("mide %d×%d, menos de %d px por el lado largo", w, h, minimo)
	}
	return ""
}

// Carga es lo que hizo `fotos cargar`.
type Carga struct {
	Copiados  []string
	Faltan    []string // de la lista y no estaban en la carpeta
	Sobran    []string // en la carpeta y no en la lista: no se copian
	Rechazado map[string]string
}

// Cargar copia a la biblioteca los archivos de la lista que estén en
// `origen`, revisándolos antes. Si alguno no pasa la revisión no se copia
// ninguno: la biblioteca queda como estaba.
func (b *Biblioteca) Cargar(origen string) (Carga, error) {
	c := Carga{Rechazado: map[string]string{}}
	enLista := map[string]bool{}
	for _, a := range Archivos() {
		enLista[a] = true
	}
	entradas, err := os.ReadDir(origen)
	if err != nil {
		return c, err
	}
	presentes := map[string][]byte{}
	for _, e := range entradas {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if !enLista[e.Name()] {
			c.Sobran = append(c.Sobran, e.Name())
			continue
		}
		datos, err := os.ReadFile(filepath.Join(origen, e.Name()))
		if err != nil {
			return c, err
		}
		if motivo := Revisar(e.Name(), datos); motivo != "" {
			c.Rechazado[e.Name()] = motivo
			continue
		}
		presentes[e.Name()] = datos
	}
	for _, a := range Archivos() {
		if _, ok := presentes[a]; !ok && c.Rechazado[a] == "" {
			c.Faltan = append(c.Faltan, a)
		}
	}
	if len(c.Rechazado) > 0 {
		return c, errors.New("hay archivos que no pasan la revisión: no se copió ninguno")
	}
	if err := os.MkdirAll(b.carpeta, 0o755); err != nil {
		return c, err
	}
	for _, a := range Archivos() {
		datos, ok := presentes[a]
		if !ok {
			continue
		}
		// Escritura atómica: un `adjuntar` que corre al mismo tiempo nunca lee
		// un archivo a medias.
		tmp := filepath.Join(b.carpeta, "."+a+".tmp")
		if err := os.WriteFile(tmp, datos, 0o644); err != nil {
			return c, err
		}
		if err := os.Rename(tmp, filepath.Join(b.carpeta, a)); err != nil {
			return c, err
		}
		c.Copiados = append(c.Copiados, a)
	}
	return c, nil
}
