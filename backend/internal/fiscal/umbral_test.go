package fiscal

import (
	"testing"
	"time"
)

// Una B sin documento que llega al umbral no se numera: ARCA la rechazaría y
// trabaría la serie. El borde es «llega», no «pasa».
func TestUmbralDeLaB(t *testing.T) {
	hoy := time.Date(2026, 11, 18, 12, 0, 0, 0, Argentina)
	umbral := MontoIdentificarConsumidorFinal(hoy)
	dni, cuit, vacio := "30123456", "20123456786", ""
	casos := []struct {
		tipo  string
		total float64
		doc   *string
		frena bool
	}{
		{"factura_b", umbral - 0.01, nil, false},
		{"factura_b", umbral, nil, true},
		{"factura_b", umbral, &vacio, true},
		{"nota_debito_b", umbral + 1, nil, true},
		{"factura_b", umbral, &dni, false},
		{"factura_b", umbral, &cuit, false},
		{"factura_a", umbral * 2, nil, false},
	}
	for _, c := range casos {
		m := FaltaIdentificarComprador(c.tipo, c.total, c.doc, hoy)
		if (m != "") != c.frena {
			t.Errorf("%s por %v con %v: %q", c.tipo, c.total, c.doc, m)
		}
	}
	if m := FaltaIdentificarComprador("factura_b", umbral, nil, hoy); m != "Desde $\u00a010.000.000 hay que cargar el DNI o CUIT del comprador." {
		t.Errorf("mensaje: %q", m)
	}
}
