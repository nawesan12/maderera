package migracion

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Los golden salen de scripts/golden/migracion.ts (el TS real) y Go tiene
// que dar lo mismo, exacto.
const dirGolden = "../../testdata/golden/migracion"

func leerGolden(t *testing.T, nombre string, destino any) {
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
		t.Fatalf("%s: %v", nombre, err)
	}
}

// comoJSON lleva cualquier cosa a lo que se ve en JSON, para comparar sin
// que importe el orden de las claves.
func comoJSON(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func igual(t *testing.T, contexto string, go_, ts any) bool {
	t.Helper()
	a, b := comoJSON(t, go_), comoJSON(t, ts)
	if !reflect.DeepEqual(a, b) {
		ga, _ := json.Marshal(a)
		gb, _ := json.Marshal(b)
		t.Errorf("%s\n  go: %s\n  ts: %s", contexto, ga, gb)
		return false
	}
	return true
}

func definicion(t *testing.T, clave string) Entidad {
	t.Helper()
	e, ok := DefinicionDe(clave)
	if !ok {
		t.Fatalf("entidad desconocida: %s", clave)
	}
	return e
}

func TestGoldenDefiniciones(t *testing.T) {
	var g struct {
		Lote      int               `json:"lote"`
		Entidades []json.RawMessage `json:"entidades"`
	}
	leerGolden(t, "definiciones.json", &g)
	if g.Lote != Lote {
		t.Errorf("lote: go %d, ts %d", Lote, g.Lote)
	}
	var ts []any
	for _, e := range g.Entidades {
		var v any
		_ = json.Unmarshal(e, &v)
		ts = append(ts, v)
	}
	igual(t, "definiciones", Entidades, ts)
}

func TestGoldenFechas(t *testing.T) {
	var casos []struct {
		Texto string  `json:"texto"`
		Iso   *string `json:"iso"`
	}
	leerGolden(t, "fechas.json", &casos)
	fallas := 0
	for _, c := range casos {
		iso, ok := InterpretarFecha(c.Texto)
		var got *string
		if ok {
			got = &iso
		}
		if (got == nil) != (c.Iso == nil) || got != nil && *got != *c.Iso {
			if fallas++; fallas <= 20 {
				t.Errorf("interpretarFecha(%q): go %v, ts %v", c.Texto, deref(got), deref(c.Iso))
			}
		}
	}
	t.Logf("%d fechas", len(casos))
}

func deref(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func TestGoldenAutomapeo(t *testing.T) {
	var casos []struct {
		Entidad   string   `json:"entidad"`
		Columnas  []string `json:"columnas"`
		Mapeo     Mapeo    `json:"mapeo"`
		Faltantes []string `json:"faltantes"`
	}
	leerGolden(t, "automapeo.json.gz", &casos)
	fallas := 0
	for i, c := range casos {
		e := definicion(t, c.Entidad)
		m := Automapear(e, c.Columnas)
		if !reflect.DeepEqual(m, c.Mapeo) || !reflect.DeepEqual(Faltantes(e, m), c.Faltantes) {
			if fallas++; fallas <= 10 {
				t.Errorf("caso %d (%s) %q:\n  go: %v %v\n  ts: %v %v", i, c.Entidad, c.Columnas, m, Faltantes(e, m), c.Mapeo, c.Faltantes)
			}
		}
	}
	t.Logf("%d mapeos", len(casos))
}

func TestGoldenFilas(t *testing.T) {
	var casos []struct {
		Entidad      string          `json:"entidad"`
		Mapeo        Mapeo           `json:"mapeo"`
		Filas        [][]string      `json:"filas"`
		Normalizadas json.RawMessage `json:"normalizadas"`
		Previa       json.RawMessage `json:"previa"`
	}
	leerGolden(t, "filas.json.gz", &casos)
	fallas, filas := 0, 0
	for i, c := range casos {
		e := definicion(t, c.Entidad)
		filas += len(c.Filas)
		var norm, previa any
		_ = json.Unmarshal(c.Normalizadas, &norm)
		_ = json.Unmarshal(c.Previa, &previa)
		ok := igual(t, "normalizarFilas, caso "+itoa(i)+" ("+c.Entidad+")", NormalizarFilas(e, c.Mapeo, c.Filas), norm) &&
			igual(t, "previsualizar, caso "+itoa(i)+" ("+c.Entidad+")", Previsualizar(e, c.Mapeo, c.Filas), previa)
		if !ok {
			if fallas++; fallas > 5 {
				t.Fatal("demasiadas diferencias")
			}
		}
	}
	t.Logf("%d archivos al azar, %d filas", len(casos), filas)
}

func TestGoldenArchivosDeMuestra(t *testing.T) {
	var casos []struct {
		Archivo  string `json:"archivo"`
		Entidad  string `json:"entidad"`
		Analisis struct {
			Error        string     `json:"error"`
			Archivo      string     `json:"archivo"`
			Columnas     []string   `json:"columnas"`
			Filas        [][]string `json:"filas"`
			Codificacion string     `json:"codificacion"`
			Mapeo        Mapeo      `json:"mapeo"`
		} `json:"analisis"`
		Previa       json.RawMessage `json:"previa"`
		Normalizadas json.RawMessage `json:"normalizadas"`
	}
	leerGolden(t, "archivos.json", &casos)
	for _, c := range casos {
		datos, err := os.ReadFile(filepath.Join(dirGolden, "archivos", c.Archivo))
		if err != nil {
			t.Fatal(err)
		}
		e := definicion(t, c.Entidad)
		a := Analizar(e, c.Archivo, datos)
		igual(t, c.Archivo+": análisis",
			[]any{a.Error, a.Archivo, a.Columnas, a.Filas, a.Codificacion, a.Mapeo},
			[]any{c.Analisis.Error, c.Analisis.Archivo, c.Analisis.Columnas, c.Analisis.Filas, c.Analisis.Codificacion, c.Analisis.Mapeo})
		if a.Error != "" {
			continue
		}
		var previa, norm any
		_ = json.Unmarshal(c.Previa, &previa)
		_ = json.Unmarshal(c.Normalizadas, &norm)
		igual(t, c.Archivo+": vista previa", Previsualizar(e, a.Mapeo, a.Filas), previa)
		igual(t, c.Archivo+": filas", NormalizarFilas(e, a.Mapeo, a.Filas), norm)
	}
}

func TestGoldenTopes(t *testing.T) {
	var casos []struct {
		Filas int    `json:"filas"`
		Error string `json:"error"`
	}
	leerGolden(t, "topes.json", &casos)
	for _, c := range casos {
		if got := demasiadas(c.Filas); got != c.Error {
			t.Errorf("%d filas: go %q, ts %q", c.Filas, got, c.Error)
		}
	}
}

func TestGoldenControles(t *testing.T) {
	var casos []struct {
		Entidad      string    `json:"entidad"`
		Normalizadas []Fila    `json:"normalizadas"`
		Base         EnLaBase  `json:"base"`
		Controles    []Control `json:"controles"`
	}
	leerGolden(t, "controles.json.gz", &casos)
	fallas := 0
	for i, c := range casos {
		if !igual(t, "controles, caso "+itoa(i)+" ("+c.Entidad+")", Controles(c.Entidad, c.Normalizadas, c.Base), c.Controles) {
			if fallas++; fallas > 5 {
				t.Fatal("demasiadas diferencias")
			}
		}
	}
	t.Logf("%d informes", len(casos))
}
