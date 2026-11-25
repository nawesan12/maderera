package pdf

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestServidorBench es el lado Go del benchmark de la tanda 12
// (bench/tanda12): sirve GET /<documento>/<caso> armando el PDF con los datos
// del golden, en cada pedido (con la decodificación del JSON incluida: el TS
// recibe los datos ya armados, así que la comparación favorece al TS).
// Solo corre con PDF_BENCH_ESCUCHAR (ej. «:8292»):
//
//	go test -c -o /tmp/pdf.test ./internal/pdf
//	PDF_BENCH_ESCUCHAR=:8292 /tmp/pdf.test -test.run TestServidorBench -test.timeout 0
func TestServidorBench(t *testing.T) {
	dir := os.Getenv("PDF_BENCH_ESCUCHAR")
	if dir == "" {
		t.Skip("solo para el benchmark (PDF_BENCH_ESCUCHAR)")
	}
	raiz, err := filepath.Abs(dirGolden)
	if err != nil {
		t.Fatal(err)
	}
	casos := map[string]casoGolden{}
	archivos, _ := filepath.Glob(filepath.Join(raiz, "*", "*.json"))
	for _, a := range archivos {
		crudo, err := os.ReadFile(a)
		if err != nil {
			t.Fatal(err)
		}
		var c casoGolden
		if err := json.Unmarshal(crudo, &c); err != nil {
			t.Fatal(err)
		}
		clave := filepath.Base(filepath.Dir(a)) + "/" + strings.TrimSuffix(filepath.Base(a), ".json")
		casos[clave] = c
	}
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clave := strings.Trim(r.URL.Path, "/")
		c, ok := casos[clave]
		doc, _, _ := strings.Cut(clave, "/")
		gen := generadores[doc]
		if !ok || gen == nil {
			http.NotFound(w, r)
			return
		}
		b, err := gen(c.Datos, c.Ahora)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write(b)
	})
	t.Logf("benchmark de PDF en %s (%d casos)", dir, len(casos))
	if err := http.ListenAndServe(dir, h); err != nil {
		t.Fatal(err)
	}
}
