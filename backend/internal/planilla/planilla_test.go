package planilla

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Los golden los genera el TS de verdad: npx tsx scripts/golden/planilla.ts.
const dirGolden = "../../testdata/golden/planilla"

func leerJSON(t *testing.T, nombre string, destino any) {
	t.Helper()
	crudo, err := os.ReadFile(filepath.Join(dirGolden, nombre))
	if err != nil {
		t.Fatal(err)
	}
	if strings.HasSuffix(nombre, ".gz") {
		z, err := gzip.NewReader(bytes.NewReader(crudo))
		if err != nil {
			t.Fatal(err)
		}
		if crudo, err = io.ReadAll(z); err != nil {
			t.Fatal(err)
		}
	}
	if err := json.Unmarshal(crudo, destino); err != nil {
		t.Fatal(err)
	}
}

// mismo compara en JSON: así un nil donde el TS tiene [] también es una
// diferencia.
func mismo(t *testing.T, got, want any) (string, string, bool) {
	t.Helper()
	g, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	w, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	return string(g), string(w), bytes.Equal(g, w)
}

type casoArchivo struct {
	Archivo string
	Tipo    string
	Datos   string
	Leida   PlanillaLeida
	Filas   []FilaImportada
}

func revisarCaso(t *testing.T, nombre string, datos []byte, c casoArchivo) bool {
	t.Helper()
	leida := LeerPlanilla(datos)
	ok := true
	if g, w, igual := mismo(t, leida, c.Leida); !igual {
		t.Errorf("%s: leerPlanilla\n  Go: %.600s\n  TS: %.600s", nombre, g, w)
		ok = false
	}
	if g, w, igual := mismo(t, LeerFilas(leida.Filas), c.Filas); !igual {
		t.Errorf("%s: leerFilas\n  Go: %.600s\n  TS: %.600s", nombre, g, w)
		ok = false
	}
	return ok
}

// DIFERENCIAS son los casos del golden que el Go no reproduce a propósito.
//
// Un DOCTYPE con declaraciones (<!ENTITY>, <!ELEMENT>, <!NOTATION>):
// fast-xml-parser registra las entidades internas pasándolas por is-unsafe y
// valida los nombres con xml-naming; reproducir eso es portar dos librerías
// más para algo que un .xlsx no puede traer (OPC prohíbe las declaraciones
// DTD en las partes del paquete). El Go no lee mal: avisa que no lo lee.
var DIFERENCIAS = map[string]string{
	"xml-doctype-entidad.xlsx": "No se pudo abrir el Excel: " + errNoSoportado.Error(),
}

func TestArchivos(t *testing.T) {
	var casos []casoArchivo
	leerJSON(t, "archivos.json", &casos)
	if len(casos) < 80 {
		t.Fatalf("faltan archivos: %d", len(casos))
	}
	for _, c := range casos {
		datos, err := os.ReadFile(filepath.Join(dirGolden, "archivos", c.Archivo))
		if err != nil {
			t.Fatal(err)
		}
		if esperado, ok := DIFERENCIAS[c.Archivo]; ok {
			if got := LeerPlanilla(datos).Error; got != esperado {
				t.Errorf("%s: el Go tenía que avisar %q y dio %q", c.Archivo, esperado, got)
			}
			continue
		}
		revisarCaso(t, c.Archivo, datos, c)
	}
}

func TestVariantes(t *testing.T) {
	var casos []casoArchivo
	leerJSON(t, "variantes.json.gz", &casos)
	if len(casos) < 1000 {
		t.Fatalf("faltan variantes: %d", len(casos))
	}
	fallos := 0
	for i, c := range casos {
		datos, err := base64.StdEncoding.DecodeString(c.Datos)
		if err != nil {
			t.Fatal(err)
		}
		if !revisarCaso(t, c.Tipo+" "+itoa(i), datos, c) {
			fallos++
			if fallos > 10 {
				t.Fatal("demasiadas diferencias")
			}
		}
	}
}

func itoa(i int) string {
	b, _ := json.Marshal(i)
	return string(b)
}

func TestInflar(t *testing.T) {
	var casos []struct{ Datos, Salida, Error string }
	leerJSON(t, "inflar.json.gz", &casos)
	if len(casos) < 1000 {
		t.Fatalf("faltan casos: %d", len(casos))
	}
	fallos := 0
	for i, c := range casos {
		datos, _ := base64.StdEncoding.DecodeString(c.Datos)
		salida, err := inflar(datos)
		got, gotErr := base64.StdEncoding.EncodeToString(salida), ""
		if err != nil {
			got, gotErr = "", err.Error()
		}
		if got != c.Salida || gotErr != c.Error {
			fallos++
			t.Errorf("caso %d (%s): Go %q %q, zlib %q %q", i, c.Datos, gotErr, got[:min(len(got), 40)], c.Error, c.Salida[:min(len(c.Salida), 40)])
			if fallos > 10 {
				t.Fatal("demasiadas diferencias")
			}
		}
	}
}

type sueltos struct {
	Columnas []string
	Numeros  []struct {
		T string
		R *string
	}
	Precios []struct {
		T string
		R *string
	}
	Encabezados []struct{ T, R string }
	Separadores []struct{ T, R string }
	Particiones []struct {
		T, Sep string
		R      [][]string
	}
	Lineas []struct {
		T, Sep string
		R      []string
	}
	Csv []struct {
		Filas []FilaPlanilla
		R     string
	}
	Grillas []struct {
		Grilla [][]string
		R      []FilaImportada
	}
}

func opcional(s string, ok bool) *string {
	if !ok {
		return nil
	}
	return &s
}

func TestSueltos(t *testing.T) {
	var g sueltos
	leerJSON(t, "sueltos.json", &g)
	if len(g.Numeros) < 2500 {
		t.Fatalf("faltan números: %d", len(g.Numeros))
	}
	if gg, w, ok := mismo(t, Columnas, g.Columnas); !ok {
		t.Errorf("COLUMNAS: Go %s, TS %s", gg, w)
	}
	for _, c := range g.Numeros {
		if gg, w, ok := mismo(t, opcional(InterpretarNumero(c.T)), c.R); !ok {
			t.Errorf("interpretarNumero(%q): Go %s, TS %s", c.T, gg, w)
		}
	}
	for _, c := range g.Precios {
		if gg, w, ok := mismo(t, opcional(InterpretarPrecio(c.T)), c.R); !ok {
			t.Errorf("interpretarPrecio(%q): Go %s, TS %s", c.T, gg, w)
		}
	}
	for _, c := range g.Encabezados {
		if r := NormalizarEncabezado(c.T); r != c.R {
			t.Errorf("normalizarEncabezado(%q): Go %q, TS %q", c.T, r, c.R)
		}
	}
	for _, c := range g.Separadores {
		if r := DetectarSeparador(c.T); r != c.R {
			t.Errorf("detectarSeparador(%q): Go %q, TS %q", c.T, r, c.R)
		}
	}
	for _, c := range g.Particiones {
		if gg, w, ok := mismo(t, PartirPlanilla(c.T, c.Sep), c.R); !ok {
			t.Errorf("partirPlanilla(%q, %q): Go %s, TS %s", c.T, c.Sep, gg, w)
		}
	}
	for _, c := range g.Lineas {
		if gg, w, ok := mismo(t, PartirLinea(c.T, c.Sep), c.R); !ok {
			t.Errorf("partirLinea(%q, %q): Go %s, TS %s", c.T, c.Sep, gg, w)
		}
	}
	for i, c := range g.Csv {
		if r := GenerarCsv(c.Filas); r != c.R {
			t.Errorf("generarCsv %d: Go %q, TS %q", i, r, c.R)
		}
	}
	for i, c := range g.Grillas {
		if gg, w, ok := mismo(t, LeerFilas(c.Grilla), c.R); !ok {
			t.Errorf("leerFilas %d: Go %s, TS %s", i, gg, w)
		}
	}
}
