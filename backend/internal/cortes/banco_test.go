package cortes

import (
	"math"
	"os"
	"testing"
	"time"

	"mjbj/internal/jsmath"
)

// despiecesDePrueba es el banco de bench/tanda11/ts/benchmark-plano.ts (antes
// scripts/benchmark-plano.ts): 200 despieces armados al azar con semilla
// fija, con la forma de los trabajos del mostrador.
func despiecesDePrueba(cantidad int, semilla uint32) []DatosDelPlano {
	azar := AzarConSemilla(semilla)
	entre := func(a, b float64) float64 { return jsmath.Round(a + float64(azar()*(b-a))) }
	redondo := func(n float64) float64 { return jsmath.Round(n/5) * 5 }
	var out []DatosDelPlano
	for range cantidad {
		var piezas []PiezaAcortar
		renglones := int(entre(3, 14))
		for range renglones {
			tipo := azar()
			var l, a float64
			switch {
			case tipo < 0.3:
				l, a = redondo(entre(500, 2200)), redondo(entre(300, 600))
			case tipo < 0.55:
				l, a = redondo(entre(300, 1200)), redondo(entre(80, 450))
			case tipo < 0.75:
				l, a = redondo(entre(300, 900)), redondo(entre(200, 600))
			case tipo < 0.9:
				l, a = redondo(entre(250, 600)), redondo(entre(100, 250))
			default:
				l, a = redondo(entre(1200, 2700)), redondo(entre(500, 1200))
			}
			n := entre(1, 4)
			veta := 0.0
			if azar() < 0.2 {
				veta = 1
			}
			piezas = append(piezas, PiezaAcortar{LargoMm: math.Max(l, a), AnchoMm: math.Min(l, a), Cantidad: n, RespetaVeta: veta})
		}
		largo := 2600.0
		if azar() < 0.7 {
			largo = 2750
		}
		out = append(out, DatosDelPlano{Piezas: piezas, PlacaLargo: largo, PlacaAncho: 1830})
	}
	return out
}

// TestBancoDelPlano es el benchmark del motor contra el del TS:
//
//	MJBJ_BANCO=1 go test -run TestBancoDelPlano -v ./internal/cortes/
func TestBancoDelPlano(t *testing.T) {
	if os.Getenv("MJBJ_BANCO") == "" {
		t.Skip("MJBJ_BANCO=1 para correr el banco")
	}
	despieces := despiecesDePrueba(200, 20260914)
	sierra := 5.0
	no := false
	for _, d := range despieces[:20] { // en blanco, como el TS
		d.AnchoSierra = &sierra
		CalcularPlano(d)
	}
	var antes, despues, piso int
	var tAntes, tDespues, peor time.Duration
	for _, d := range despieces {
		d.AnchoSierra = &sierra
		h := d
		h.Busqueda = &no
		t0 := time.Now()
		ph := CalcularPlano(h)
		tAntes += time.Since(t0)
		t0 = time.Now()
		pb := CalcularPlano(d)
		dt := time.Since(t0)
		tDespues += dt
		peor = max(peor, dt)
		antes += len(ph.Placas)
		despues += len(pb.Placas)
		util := 0.0
		for _, p := range d.Piezas {
			util += p.LargoMm * p.AnchoMm * p.Cantidad
		}
		piso += int(math.Ceil(util / (d.PlacaLargo * d.PlacaAncho)))
	}
	n := float64(len(despieces))
	ms := func(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }
	t.Logf("Banco: %d despieces, sierra de 5 mm. Piso teórico: %d placas.", len(despieces), piso)
	t.Logf("  Heurística sola: %d placas, %.2f ms por despiece.", antes, ms(tAntes)/n)
	t.Logf("  Con búsqueda:    %d placas, %.2f ms por despiece (el peor, %.1f ms).", despues, ms(tDespues)/n, ms(peor))
	// El mismo banco en el TS da 559 y 534 (scripts/benchmark-plano.ts, 1/10/2026).
	if antes != 559 || despues != 534 {
		t.Errorf("las placas no son las del TS: %d y %d", antes, despues)
	}
}

// BenchmarkPlano: go test -bench Plano -run x ./internal/cortes/
func BenchmarkPlano(b *testing.B) {
	despieces := despiecesDePrueba(200, 20260914)
	sierra := 5.0
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		d := despieces[i%len(despieces)]
		d.AnchoSierra = &sierra
		CalcularPlano(d)
	}
}
