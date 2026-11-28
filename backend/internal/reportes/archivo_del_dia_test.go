package reportes

import (
	"testing"
	"time"
)

// A las 22:15 de acá ya es mañana en UTC: el nombre lleva el día de acá
// (mes simulado, M2S2-103).
func TestArchivoDelDiaEnHoraDeAca(t *testing.T) {
	noche := time.Date(2026, 11, 27, 1, 15, 0, 0, time.UTC) // 26/11 22:15 en Argentina
	if got := ArchivoDelDia("deudores", noche); got != "deudores-2026-11-26.csv" {
		t.Errorf("got %q", got)
	}
}
