package reportes

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/cobros"
)

// El cierre con el volumen de ISIS (testdata/volumen.sql). No corre en la
// suite: hace falta una base sembrada a mano y tarda. MJBJ_VOLUMEN es su URL.
//
//   - Mide lo que cuesta cada parte del cierre y las cuatro llamadas de
//     /admin/cierre a la vez (go test -run Volumen -v).
//   - Con MJBJ_VOLUMEN_FOTO (una carpeta fuera del repo) compara byte a byte
//     los asientos, los pendientes y el listado de deudores contra la foto
//     que sacó el código de antes; con MJBJ_VOLUMEN_FOTO_ESCRIBIR=1 la saca.
//     Así un cambio de rendimiento no puede mover un centavo sin que se vea.
//   - Con MJBJ_VOLUMEN_FIJAR=1 primero fija los repartos (mjbj repartos),
//     que es como queda la base de producción.

// ahoraDelVolumen es el «hoy» de la base sembrada: la historia llega a
// mediados de noviembre de 2026.
var ahoraDelVolumen = time.Date(2026, 11, 19, 12, 0, 0, 0, Argentina)

// mesesDeLaFoto: el primero, uno cerrado con anulaciones posteriores, el
// último cerrado y el abierto.
var mesesDeLaFoto = []string{"2024-01", "2025-06", "2026-10", "2026-11"}

func volumen(t *testing.T) (*Servicio, *pgxpool.Pool, string) {
	t.Helper()
	url := os.Getenv("MJBJ_VOLUMEN")
	if url == "" {
		t.Skip("sin MJBJ_VOLUMEN")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var nombre string
	if err := pool.QueryRow(ctx, `select current_database()`).Scan(&nombre); err != nil {
		t.Fatal(err)
	}
	s := Nuevo(pool, silencio)
	s.ahora = func() time.Time { return ahoraDelVolumen }
	return s, pool, nombre
}

func medir(t *testing.T, nombre string, f func() error) {
	t.Helper()
	t0 := time.Now()
	if err := f(); err != nil {
		t.Fatalf("%s: %v", nombre, err)
	}
	t.Logf("%-40s %v", nombre, time.Since(t0).Round(time.Millisecond))
}

func TestVolumenDelCierre(t *testing.T) {
	s, pool, base := volumen(t)
	ctx := context.Background()
	if os.Getenv("MJBJ_VOLUMEN_FIJAR") == "1" {
		medir(t, "FijarRepartosDeAntes", func() error {
			return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
				ids, err := cobros.FijarRepartosDeAntes(ctx, tx)
				t.Logf("fijados: %d", len(ids))
				return err
			})
		})
	}
	var recibos, conAnticipo, sinFijar int
	if err := pool.QueryRow(ctx, `select count(*), count(*) filter (where reparto_anticipo > 0.005), count(*) filter (where reparto_deudores is null)
		from receipts`).Scan(&recibos, &conAnticipo, &sinFijar); err != nil {
		t.Fatal(err)
	}
	t.Logf("%s: %d recibos, %d con anticipo (%.1f %%), %d sin fijar", base, recibos, conAnticipo, float64(conAnticipo)*100/float64(max(recibos, 1)), sinFijar)

	octubre := PeriodoDelCierre("2026-10", ahoraDelVolumen)
	_, ihasta := instantes(octubre.Desde, octubre.Hasta)
	var ev []cobros.EventoDeCuenta
	medir(t, "CargarEventos (pool, con JIT)", func() error {
		var err error
		ev, err = cobros.CargarEventos(ctx, pool, ihasta, "")
		return err
	})
	medir(t, "RepartirCobros", func() error { cobros.RepartirCobros(ev); return nil })
	t.Logf("eventos: %d", len(ev))
	medir(t, "repartoHasta", func() error { _, err := s.repartoHasta(ctx, ihasta); return err })
	medir(t, "AsientosDelPeriodo (oct)", func() error { _, err := s.AsientosDelPeriodo(ctx, octubre.Desde, octubre.Hasta); return err })
	medir(t, "AsientosDelPeriodo (2000..oct)", func() error {
		_, err := s.AsientosDelPeriodo(ctx, time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC), octubre.Hasta)
		return err
	})
	medir(t, "PendientesDelCierre (oct)", func() error { _, err := s.PendientesDelCierre(ctx, octubre.Desde, octubre.Hasta); return err })
	medir(t, "CsvDeudores", func() error { _, err := s.CsvDeudores(ctx, ahoraDelVolumen); return err })

	// Las cuatro llamadas de /admin/cierre a la vez, como las hace la página.
	var wg sync.WaitGroup
	t0 := time.Now()
	vista := map[string]func() error{
		"resumen":    func() error { _, err := s.ResumenDelMes(ctx, octubre.Desde, octubre.Hasta); return err },
		"pendientes": func() error { _, err := s.PendientesDelCierre(ctx, octubre.Desde, octubre.Hasta); return err },
		"asientos":   func() error { _, err := s.AsientosDelPeriodo(ctx, octubre.Desde, octubre.Hasta); return err },
		"asientos-b": func() error { _, err := s.AsientosDelPeriodo(ctx, octubre.Desde, octubre.Hasta); return err },
	}
	for n, f := range vista {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := f(); err != nil {
				t.Errorf("%s: %v", n, err)
			}
			t.Logf("vista del cierre: %-12s %v", n, time.Since(t0).Round(time.Millisecond))
		}()
	}
	wg.Wait()

	if dir := os.Getenv("MJBJ_VOLUMEN_FOTO"); dir != "" {
		fotoDelCierre(t, s, filepath.Join(dir, base), os.Getenv("MJBJ_VOLUMEN_FOTO_ESCRIBIR") == "1")
	}
}

// fotoDelCierre saca o compara lo que el cierre le da al estudio.
func fotoDelCierre(t *testing.T, s *Servicio, dir string, escribir bool) {
	t.Helper()
	ctx := context.Background()
	archivos := map[string]string{}
	for _, mes := range mesesDeLaFoto {
		p := PeriodoDelCierre(mes, ahoraDelVolumen)
		a, err := s.AsientosDelPeriodo(ctx, p.Desde, p.Hasta)
		if err != nil {
			t.Fatal(err)
		}
		archivos["asientos-"+mes+".csv"] = CsvAsientos(a, "blanco")
		archivos["asientos-B-"+mes+".csv"] = CsvAsientos(a, CircuitoNegro)
		pend, err := s.PendientesDelCierre(ctx, p.Desde, p.Hasta)
		if err != nil {
			t.Fatal(err)
		}
		j, _ := json.MarshalIndent(pend, "", "  ")
		archivos["pendientes-"+mes+".json"] = string(j)
	}
	d, err := s.CsvDeudores(ctx, ahoraDelVolumen)
	if err != nil {
		t.Fatal(err)
	}
	archivos["deudores.csv"] = d
	if escribir {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		for n, c := range archivos {
			if err := os.WriteFile(filepath.Join(dir, n), []byte(c), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		t.Logf("foto escrita en %s (%d archivos)", dir, len(archivos))
		return
	}
	for n, c := range archivos {
		antes, err := os.ReadFile(filepath.Join(dir, n))
		if err != nil {
			t.Fatalf("falta la foto %s: %v", n, err)
		}
		if string(antes) != c {
			t.Errorf("%s cambió (%d bytes antes, %d ahora)", n, len(antes), len(c))
		}
	}
	t.Logf("foto: %d archivos iguales", len(archivos))
}
