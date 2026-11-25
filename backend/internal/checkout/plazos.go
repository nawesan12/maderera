package checkout

import "time"

// lib/plazos.ts: el compromiso de respuesta de un presupuesto del sitio.
// El horario de atención se cuenta **en Buenos Aires**: el TS usaba la zona
// del servidor (UTC en el contenedor), y «de 8 a 16» eran de 5 a 13.

const (
	apertura     = 8
	cierre       = 16
	cierreSabado = 12
)

func cierreDelDia(t time.Time) int {
	switch t.Weekday() {
	case time.Sunday:
		return 0
	case time.Saturday:
		return cierreSabado
	}
	return cierre
}

func aLaHora(t time.Time, h int) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), h, 0, 0, 0, argentina)
}

func acomodarAlHorario(f time.Time) time.Time {
	v := f.In(argentina)
	for vueltas := 0; cierreDelDia(v) == 0 && vueltas < 7; vueltas++ {
		v = aLaHora(v.AddDate(0, 0, 1), apertura)
	}
	c := cierreDelDia(v)
	if v.Hour() < apertura {
		v = aLaHora(v, apertura)
	} else if v.Hour() >= c {
		v = aLaHora(v, c)
	}
	return v
}

// VencimientoExpress son 24 horas de reloj, corridas al horario de atención.
func VencimientoExpress(desde time.Time) time.Time {
	return acomodarAlHorario(desde.Add(24 * time.Hour))
}

// VencimientoDelDia es el cierre del día en que entró, o el del próximo día
// de atención.
func VencimientoDelDia(desde time.Time) time.Time {
	v := desde.In(argentina)
	if c := cierreDelDia(v); c > 0 && v.Hour() < c {
		return aLaHora(v, c)
	}
	return acomodarAlHorario(aLaHora(v.AddDate(0, 0, 1), apertura))
}
