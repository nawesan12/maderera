package fiscal

import "testing"

func TestPercepcionIibb(t *testing.T) {
	fila := &FilaPadron{Alicuota: 2.5, Desde: "2026-11-01", Hasta: "2026-11-30"}
	tres := 3.0
	casos := []struct {
		nombre, condicion, cuit, dia string
		fila                         *FilaPadron
		sinPadron                    *float64
		alicuota                     float64
		percibe                      bool
	}{
		{"consumidor final", ConsumidorFinal, "30589445259", "2026-11-10", fila, &tres, 0, false},
		{"exento", "exento", "30589445259", "2026-11-10", fila, &tres, 0, false},
		{"sin CUIT", ResponsableInscripto, "", "2026-11-10", fila, &tres, 0, false},
		{"en el padrón", ResponsableInscripto, "30-58944525-9", "2026-11-10", fila, nil, 2.5, true},
		{"el último día de la vigencia", ResponsableInscripto, "30589445259", "2026-11-30", fila, nil, 2.5, true},
		{"vencido y sin regla", ResponsableInscripto, "30589445259", "2026-12-01", fila, nil, 0, false},
		{"vencido con regla del contador", ResponsableInscripto, "30589445259", "2026-12-01", fila, &tres, 3, true},
		{"no figura", Monotributista, "20123456786", "2026-11-10", nil, nil, 0, false},
		{"alícuota cero en el padrón", ResponsableInscripto, "30589445259", "2026-11-10",
			&FilaPadron{Alicuota: 0, Desde: "2026-11-01", Hasta: "2026-11-30"}, &tres, 0, false},
	}
	for _, c := range casos {
		a, p := PercepcionIibb(c.condicion, c.cuit, c.fila, c.dia, c.sinPadron)
		if a != c.alicuota || p != c.percibe {
			t.Errorf("%s: %v %v", c.nombre, a, p)
		}
	}
}

func TestLeerLineaDelPadron(t *testing.T) {
	l, ok := LeerLineaDelPadron("P;25102026;01112026;30112026;30589445259;C;N;N;1,50;00;")
	if !ok || l.Cuit != "30589445259" || l.Alicuota != 1.5 || l.Desde != "2026-11-01" || l.Hasta != "2026-11-30" {
		t.Fatalf("%+v %v", l, ok)
	}
	for _, mala := range []string{
		"R;25102026;01112026;30112026;30589445259;C;N;N;1,50;00;", // retención
		"P;25102026;01112026;30112026;30589445250;C;N;N;1,50;00;", // dígito verificador
		"P;25102026;01132026;30112026;30589445259;C;N;N;1,50;00;", // mes 13
		"P;25102026;01112026;30112026;30589445259;C;N;N;abc;00;",
		"",
	} {
		if _, ok := LeerLineaDelPadron(mala); ok {
			t.Errorf("aceptó %q", mala)
		}
	}
}
