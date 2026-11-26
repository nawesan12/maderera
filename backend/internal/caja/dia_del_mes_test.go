package caja

import (
	"testing"
	"time"
)

// El gasto guarda su día a medianoche UTC: el mes argentino se compara con
// esos días, no con el instante de las 3 de la mañana UTC.
func TestDiaDelMes(t *testing.T) {
	desde, hasta := MesArgentino("2026-11", time.Date(2026, 11, 26, 12, 0, 0, 0, Argentina))
	if d := diaDelMes(desde); !d.Equal(time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("desde: %v", d)
	}
	if h := diaDelMes(hasta); !h.Equal(time.Date(2026, 11, 30, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("hasta: %v", h)
	}
}
