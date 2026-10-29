package pdf

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// El golden de los documentos: scripts/golden/pdf.ts guardó, por cada caso,
// los datos y el PDF que arma el TS con pdf-lib. Acá Go arma el mismo
// documento y los dos se comparan rasterizados (pdftoppm) y por su texto
// (pdftotext).
//
// El umbral: a 100 ppp en grises, la fracción de píxeles que difieren en más
// de 8 niveles (de 255) tiene que ser a lo sumo umbralPixeles (0,01 %), en
// cada página. Como Go escribe los mismos operadores con los mismos números,
// hoy da cero en todos los casos; el margen cubre que el rasterizador
// redondee distinto un borde de glifo. Para tener una idea: medir sin el
// kerning (un número alineado a la derecha corrido medio punto) ya da
// 0,09–0,15 %, así que el umbral no deja pasar un error de medida.
const (
	umbralPixeles  = 0.0001 // 0,01 %
	toleranciaGris = 8
	resolucion     = 100
)

// generadores: documento → cómo armarlo con Go desde el JSON del caso. Cada
// documento se suma en su propio golden_<doc>_test.go con registrar().
var generadores = map[string]func(datos json.RawMessage, ahora time.Time) ([]byte, error){}

func registrar(doc string, f func(datos json.RawMessage, ahora time.Time) ([]byte, error)) {
	generadores[doc] = f
}

// decodificar es el atajo para un documento que recibe un solo struct.
func decodificar[T any](f func(T, time.Time) ([]byte, error)) func(json.RawMessage, time.Time) ([]byte, error) {
	return func(datos json.RawMessage, ahora time.Time) ([]byte, error) {
		var v T
		if err := json.Unmarshal(datos, &v); err != nil {
			return nil, err
		}
		return f(v, ahora)
	}
}

func init() {
	registrar("lista-precios", decodificar(ListaDePrecios))
	registrar("reposicion", decodificar(Reposicion))
}

type casoGolden struct {
	Ahora time.Time       `json:"ahora"`
	Datos json.RawMessage `json:"datos"`
}

const dirGolden = "../../testdata/golden/pdf"

func herramientas(t *testing.T) {
	t.Helper()
	for _, h := range []string{"pdftoppm", "pdftotext"} {
		if _, err := exec.LookPath(h); err != nil {
			if os.Getenv("CI") != "" {
				t.Fatalf("falta %s (poppler)", h)
			}
			t.Skipf("falta %s (brew install poppler)", h)
		}
	}
}

func TestGoldenPDF(t *testing.T) {
	herramientas(t)
	docs, err := os.ReadDir(dirGolden)
	if err != nil {
		t.Fatal(err)
	}
	vistos := 0
	for _, d := range docs {
		if !d.IsDir() {
			continue
		}
		gen, ok := generadores[d.Name()]
		if !ok {
			t.Errorf("%s: hay golden pero Go no tiene el generador", d.Name())
			continue
		}
		casos, _ := filepath.Glob(filepath.Join(dirGolden, d.Name(), "*.json"))
		sort.Strings(casos)
		for _, c := range casos {
			nombre := d.Name() + "/" + strings.TrimSuffix(filepath.Base(c), ".json")
			vistos++
			t.Run(nombre, func(t *testing.T) {
				t.Parallel()
				compararCaso(t, gen, c)
			})
		}
	}
	if vistos == 0 {
		t.Fatal("no hay casos golden")
	}
}

func compararCaso(t *testing.T, gen func(json.RawMessage, time.Time) ([]byte, error), archivo string) {
	crudo, err := os.ReadFile(archivo)
	if err != nil {
		t.Fatal(err)
	}
	var caso casoGolden
	if err := json.Unmarshal(crudo, &caso); err != nil {
		t.Fatal(err)
	}
	deGo, err := gen(caso.Datos, caso.Ahora)
	if err != nil {
		t.Fatalf("Go no armó el PDF: %v", err)
	}
	dir := t.TempDir()
	rutaGo := filepath.Join(dir, "go.pdf")
	if err := os.WriteFile(rutaGo, deGo, 0o644); err != nil {
		t.Fatal(err)
	}
	rutaTS := strings.TrimSuffix(archivo, ".json") + ".pdf"

	// El texto, igual.
	textoTS, textoGo := extraerTexto(t, rutaTS), extraerTexto(t, rutaGo)
	if textoTS != textoGo {
		t.Errorf("el texto difiere:\n%s", primeraDiferencia(textoTS, textoGo))
	}

	// Los píxeles, bajo el umbral.
	pagTS := rasterizar(t, rutaTS, filepath.Join(dir, "ts"))
	pagGo := rasterizar(t, rutaGo, filepath.Join(dir, "go"))
	if len(pagTS) != len(pagGo) {
		t.Fatalf("páginas: TS %d, Go %d", len(pagTS), len(pagGo))
	}
	peor := 0.0
	for i := range pagTS {
		f, err := diferencia(pagTS[i], pagGo[i])
		if err != nil {
			t.Fatalf("página %d: %v", i+1, err)
		}
		if f > peor {
			peor = f
		}
		if f > umbralPixeles {
			t.Errorf("página %d: %.4f %% de los píxeles difiere (umbral %.4f %%)", i+1, f*100, umbralPixeles*100)
		}
	}
	registrarDiferencia(filepath.Base(filepath.Dir(archivo)), peor)
}

var (
	peores   = map[string]float64{}
	peoresMu = make(chan struct{}, 1)
)

func registrarDiferencia(doc string, f float64) {
	peoresMu <- struct{}{}
	if f > peores[doc] {
		peores[doc] = f
	}
	if _, ok := peores[doc]; !ok {
		peores[doc] = f
	}
	<-peoresMu
}

func TestMain(m *testing.M) {
	codigo := m.Run()
	if len(peores) > 0 && os.Getenv("PDF_DIFERENCIAS") != "" {
		docs := make([]string, 0, len(peores))
		for d := range peores {
			docs = append(docs, d)
		}
		sort.Strings(docs)
		for _, d := range docs {
			fmt.Printf("diferencia máxima %-22s %.5f %%\n", d, peores[d]*100)
		}
	}
	os.Exit(codigo)
}

func extraerTexto(t *testing.T, ruta string) string {
	t.Helper()
	out, err := exec.Command("pdftotext", "-enc", "UTF-8", ruta, "-").Output()
	if err != nil {
		t.Fatalf("pdftotext %s: %v", ruta, err)
	}
	return string(out)
}

func primeraDiferencia(a, b string) string {
	la, lb := strings.Split(a, "\n"), strings.Split(b, "\n")
	for i := 0; i < len(la) || i < len(lb); i++ {
		var x, y string
		if i < len(la) {
			x = la[i]
		}
		if i < len(lb) {
			y = lb[i]
		}
		if x != y {
			return fmt.Sprintf("renglón %d\n  TS: %q\n  Go: %q", i+1, x, y)
		}
	}
	return "(iguales)"
}

func rasterizar(t *testing.T, ruta, prefijo string) []string {
	t.Helper()
	if out, err := exec.Command("pdftoppm", "-r", fmt.Sprint(resolucion), "-gray", ruta, prefijo).CombinedOutput(); err != nil {
		t.Fatalf("pdftoppm %s: %v\n%s", ruta, err, out)
	}
	paginas, _ := filepath.Glob(prefijo + "-*.pgm")
	sort.Slice(paginas, func(i, j int) bool {
		if len(paginas[i]) != len(paginas[j]) {
			return len(paginas[i]) < len(paginas[j])
		}
		return paginas[i] < paginas[j]
	})
	return paginas
}

// leerPGM lee un PGM binario (P5) de 8 bits, como lo escribe pdftoppm.
func leerPGM(ruta string) (ancho, alto int, px []byte, err error) {
	f, err := os.ReadFile(ruta)
	if err != nil {
		return 0, 0, nil, err
	}
	r := bufio.NewReader(bytes.NewReader(f))
	var magia string
	var maximo int
	if _, err := fmt.Fscan(r, &magia, &ancho, &alto, &maximo); err != nil {
		return 0, 0, nil, err
	}
	if magia != "P5" || maximo != 255 {
		return 0, 0, nil, fmt.Errorf("PGM inesperado: %s %d", magia, maximo)
	}
	if _, err := r.ReadByte(); err != nil { // el blanco después del máximo
		return 0, 0, nil, err
	}
	px = make([]byte, ancho*alto)
	if _, err := r.Read(px[:0]); err != nil {
		return 0, 0, nil, err
	}
	n := 0
	for n < len(px) {
		m, err := r.Read(px[n:])
		if err != nil {
			return 0, 0, nil, err
		}
		n += m
	}
	return ancho, alto, px, nil
}

func diferencia(a, b string) (float64, error) {
	wa, ha, pa, err := leerPGM(a)
	if err != nil {
		return 0, err
	}
	wb, hb, pb, err := leerPGM(b)
	if err != nil {
		return 0, err
	}
	if wa != wb || ha != hb {
		return 1, fmt.Errorf("tamaño distinto: %dx%d contra %dx%d", wa, ha, wb, hb)
	}
	distintos := 0
	for i := range pa {
		d := int(pa[i]) - int(pb[i])
		if d < -toleranciaGris || d > toleranciaGris {
			distintos++
		}
	}
	return float64(distintos) / float64(len(pa)), nil
}

// El logo de Go es una copia del de public/: tienen que ser el mismo archivo.
func TestLogoIgualAlDePublic(t *testing.T) {
	publico, err := os.ReadFile("../../../public/marca/logo-maderera.png")
	if err != nil {
		t.Skip("sin public/ al lado (no es el repo entero)")
	}
	if !bytes.Equal(publico, logoPNG) {
		t.Fatal("backend/internal/pdf/logo-maderera.png no es igual a public/marca/logo-maderera.png: copialo de nuevo")
	}
}
