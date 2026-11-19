package cobros

import (
	"testing"
	"time"
)

// La fecha de pago de un cheque (T3, hallazgo 41): de hoy − 30 a hoy + 360
// en hora argentina, y una fecha que no existe no entra.
func TestFechaDeCheque(t *testing.T) {
	// Las 23.30 del 18/11 en Argentina ya son el 19 en UTC: el día es el de acá.
	ahora := time.Date(2026, 11, 18, 23, 30, 0, 0, argentina)
	casos := []struct {
		fecha string
		bien  bool
	}{
		{"2026-10-19", true},  // hoy − 30
		{"2026-10-18", false}, // hoy − 31
		{"2026-11-18", true},
		{"2027-11-13", true},  // hoy + 360
		{"2027-11-14", false}, // hoy + 361
		{"2035-01-01", false},
	}
	for _, c := range casos {
		f, ok := LeerFechaDeCheque(c.fecha)
		if !ok {
			t.Fatalf("%s no se leyó", c.fecha)
		}
		if m := RevisarFechaDeCheque(f, ahora); (m == "") != c.bien {
			t.Errorf("%s: %q", c.fecha, m)
		}
	}
	if m := RevisarFechaDeCheque(time.Date(2035, 1, 1, 12, 0, 0, 0, argentina), ahora); m != "La fecha de pago del cheque tiene que estar entre el 19/10/2026 y el 13/11/2027." {
		t.Errorf("mensaje: %q", m)
	}
	for _, mala := range []string{"2026-02-31", "2026-13-01", "2026-2-1", "", "2026-02-29"} {
		if _, ok := LeerFechaDeCheque(mala); ok {
			t.Errorf("%q no existe y se leyó", mala)
		}
	}
	if _, ok := LeerFechaDeCheque("2028-02-29"); !ok {
		t.Error("2028 es bisiesto")
	}
}
