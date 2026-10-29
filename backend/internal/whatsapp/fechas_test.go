package whatsapp

import (
	"testing"
	"time"
)

// TestFechasEnHoraArgentina: el TS formateaba con la zona del servidor
// (fechaCorta y fechaHora de lib/formato.ts, sin timeZone) y el contenedor de
// la aplicación en la VPS corre en UTC (el compose le pone TZ solo a la base
// y al cron): «Avisado a mano el 29/10, 03:05» cuando se avisó a las 00:05, y
// la fecha que precarga la plantilla ya era la de mañana desde las 21. Go las
// dice siempre en hora de Argentina.
func TestFechasEnHoraArgentina(t *testing.T) {
	instante := time.Date(2026, 10, 29, 3, 5, 0, 0, time.UTC)
	if got := FechaHora(instante); got != "29/10, 00:05" {
		t.Errorf("FechaHora = %q", got)
	}
	if got := FechaCorta(time.Date(2026, 10, 30, 1, 0, 0, 0, time.UTC)); got != "29/10/26" {
		t.Errorf("FechaCorta = %q", got)
	}
}
