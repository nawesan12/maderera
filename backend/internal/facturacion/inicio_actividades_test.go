package facturacion

import (
	"testing"
	"time"

	"mjbj/internal/pdf"
)

// M2S1-016: el inicio de actividades 1985-03-01 (guardado a medianoche UTC)
// salía «28/02/85» en el PDF.
func TestInicioActividadesNoSeCorreUnDia(t *testing.T) {
	guardado := time.Date(1985, 3, 1, 0, 0, 0, 0, time.UTC)
	if got := pdf.FechaSolaCorta(*diaGuardado(&guardado)); got != "01/03/85" {
		t.Fatalf("inicio de actividades: %q, quería 01/03/85", got)
	}
	if diaGuardado(nil) != nil {
		t.Fatal("sin inicio tiene que quedar nil")
	}
}
