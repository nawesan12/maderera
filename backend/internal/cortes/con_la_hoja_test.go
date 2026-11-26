package cortes

import (
	"fmt"
	"slices"
	"testing"
)

func pasadasDeLaHoja(t *testing.T, p Plano) (total, cobrables int) {
	t.Helper()
	h, err := ArmarHojaDeCorte(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, pt := range h.Patrones {
		total += pt.PasadasPorPlaca * len(pt.Placas)
		if !pt.SeVendeEntera {
			cobrables += pt.PasadasPorPlaca * len(pt.Placas)
		}
	}
	return total, cobrables
}

func retalesDeLaHoja(t *testing.T, p Plano) []string {
	t.Helper()
	h, err := ArmarHojaDeCorte(p)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, pt := range h.Patrones {
		for range pt.Placas {
			for _, s := range pt.Dibujo.Sobrantes {
				if s.Tipo == "retal" {
					out = append(out, fmt.Sprintf("%v×%v", s.Rect.Ancho, s.Rect.Alto))
				}
			}
		}
	}
	slices.Sort(out)
	return out
}

// La ficha, el plano y la hoja dicen las mismas pasadas y los mismos retales
// (mes simulado, H230: en CRT-9 la hoja decía 16 cortes y la ficha 13, y los
// retales eran otros). Sin ConLaHoja, 155 de los 200 despieces del banco dan
// distinto.
func TestElPlanoCuentaComoLaHoja(t *testing.T) {
	distintos := 0
	for i, d := range despiecesDePrueba(200, 7) {
		motor := CalcularPlano(d)
		if total, _ := pasadasDeLaHoja(t, motor); total != motor.Pasadas {
			distintos++
		}
		p := ConLaHoja(motor)
		// La hoja se arma siempre del plano del motor (la ficha, el PTX y la
		// hoja de la pantalla): ConLaHoja tiene que decir lo mismo que ella.
		total, cobrables := pasadasDeLaHoja(t, motor)
		if p.Pasadas != total || p.PasadasCobrables != cobrables {
			t.Fatalf("despiece %d: plano %d/%d pasadas, hoja %d/%d", i, p.Pasadas, p.PasadasCobrables, total, cobrables)
		}
		var retales []string
		piezas := 0
		for _, placa := range p.Placas {
			piezas += len(placa.Piezas)
			for _, r := range placa.Recortes {
				retales = append(retales, fmt.Sprintf("%v×%v", r.Ancho, r.Alto))
			}
		}
		slices.Sort(retales)
		if h := retalesDeLaHoja(t, motor); !slices.Equal(h, retales) {
			t.Fatalf("despiece %d: retales del plano %v, de la hoja %v", i, retales, h)
		}
		if piezas != motor.TotalPiezas || len(p.Placas) != len(motor.Placas) || p.PlacasEnteras != motor.PlacasEnteras {
			t.Fatalf("despiece %d: cambió lo que se acomoda", i)
		}
	}
	if distintos == 0 {
		t.Fatal("el banco ya no muestra la diferencia: la prueba no prueba nada")
	}
}

// Cada placa conserva sus piezas: dos placas iguales no comparten la unidad
// de la primera (el acomodo a mano mueve piezas por índice y unidad).
func TestConLaHojaConservaLasPiezasDeCadaPlaca(t *testing.T) {
	d := DatosDelPlano{Piezas: []PiezaAcortar{{LargoMm: 1200, AnchoMm: 1700, Cantidad: 4}}, PlacaLargo: 2600, PlacaAncho: 1830}
	p := ConLaHoja(CalcularPlano(d))
	vistas := map[[2]int]bool{}
	for _, placa := range p.Placas {
		for _, x := range placa.Piezas {
			k := [2]int{x.Indice, x.Unidad}
			if vistas[k] {
				t.Fatalf("la pieza %v aparece dos veces", k)
			}
			vistas[k] = true
		}
	}
	if len(vistas) != 4 {
		t.Fatalf("piezas: %d", len(vistas))
	}
}
