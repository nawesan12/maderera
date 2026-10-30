package cobros

import (
	"math"
	"sort"
	"time"

	"mjbj/internal/jsmath"
)

// Movimiento de la cuenta corriente para el aging: positivo es deuda,
// negativo es pago.
type Movimiento struct {
	Monto float64
	Fecha time.Time
}

// Tramo del aging.
type Tramo struct {
	Etiqueta string  `json:"etiqueta"`
	Desde    int     `json:"desde"`
	Hasta    *int    `json:"hasta"`
	Monto    float64 `json:"monto"`
}

// Aging es la deuda por antigüedad.
type Aging struct {
	Tramos           []Tramo `json:"tramos"`
	Total            float64 `json:"total"`
	AFavor           float64 `json:"aFavor"`
	DiasDeLaMasVieja *int    `json:"diasDeLaMasVieja"`
}

func intp(n int) *int { return &n }

func diasEntre(desde, hasta time.Time) int {
	return int(math.Max(0, math.Floor(float64(hasta.UnixMilli()-desde.UnixMilli())/86_400_000)))
}

// medioCentavo es la tolerancia de la cuenta: lo que queda por debajo es
// resto de la coma flotante, no plata.
const medioCentavo = 0.005

// CalcularAging es calcularAging: los pagos cancelan la deuda más vieja
// primero (FIFO); lo que sobra queda a favor y se come la deuda siguiente.
//
// Bug del TS arreglado: la cuenta en coma flotante dejaba restos. Con
// 0,29999999999999998 a favor, una compra de 0,30 quedaba con 5,5e-17
// pendientes, y una cuenta con saldo real cero decía «Tiene deuda de hace
// 198 días» (y frenaba la venta a cuenta). Ahora lo que no llega a medio
// centavo no queda pendiente ni a favor.
func CalcularAging(movs []Movimiento, hoy time.Time) Aging {
	ordenados := append([]Movimiento(nil), movs...)
	sort.SliceStable(ordenados, func(i, j int) bool { return ordenados[i].Fecha.UnixMilli() < ordenados[j].Fecha.UnixMilli() })
	type pendiente struct {
		monto float64
		fecha time.Time
	}
	var pendientes []*pendiente
	aFavor := 0.0
	for _, m := range ordenados {
		if m.Monto > 0 {
			deuda := m.Monto
			if aFavor > 0 {
				usa := math.Min(aFavor, deuda)
				aFavor -= usa
				deuda -= usa
			}
			if aFavor <= medioCentavo {
				aFavor = 0
			}
			if deuda > medioCentavo {
				pendientes = append(pendientes, &pendiente{deuda, m.Fecha})
			}
			continue
		}
		pago := -m.Monto
		for pago > 0 && len(pendientes) > 0 {
			vieja := pendientes[0]
			cancela := math.Min(pago, vieja.monto)
			vieja.monto -= cancela
			pago -= cancela
			if vieja.monto <= medioCentavo {
				pendientes = pendientes[1:]
			}
		}
		if pago > medioCentavo {
			aFavor += pago
		}
	}
	tramos := []Tramo{
		{"Al día", 0, intp(30), 0}, {"31 a 60 días", 31, intp(60), 0},
		{"61 a 90 días", 61, intp(90), 0}, {"Más de 90 días", 91, nil, 0},
	}
	total := 0.0
	for _, p := range pendientes {
		d := diasEntre(p.fecha, hoy)
		i := len(tramos) - 1
		for j, t := range tramos {
			if d >= t.Desde && (t.Hasta == nil || d <= *t.Hasta) {
				i = j
				break
			}
		}
		tramos[i].Monto += p.monto
		total += p.monto
	}
	a := Aging{Tramos: tramos, Total: jsmath.Round(total*100) / 100, AFavor: jsmath.Round(aFavor*100) / 100}
	if len(pendientes) > 0 {
		a.DiasDeLaMasVieja = intp(diasEntre(pendientes[0].fecha, hoy))
	}
	return a
}

// Deuda para priorizar la cobranza.
type Deuda struct {
	Vencido          float64
	DiasDeLaMasVieja *int
	DiasCredito      int
	Bloqueada        bool
}

// Prioridad de cobranza.
type Prioridad struct {
	Urgencia    string  `json:"urgencia"`
	Puntaje     float64 `json:"puntaje"`
	DiasVencida int     `json:"diasVencida"`
}

// MaxSafeInteger es Number.MAX_SAFE_INTEGER.
const MaxSafeInteger = 9007199254740991

// PrioridadDeCobranza es prioridadDeCobranza: la cuenta bloqueada primero,
// después lo vencido por los días vencido.
func PrioridadDeCobranza(d Deuda) Prioridad {
	dv := 0
	if d.DiasDeLaMasVieja != nil {
		dv = max(0, *d.DiasDeLaMasVieja-d.DiasCredito)
	}
	if d.Bloqueada {
		return Prioridad{"bloqueada", MaxSafeInteger, dv}
	}
	if d.Vencido <= 0 || dv <= 0 {
		return Prioridad{"al-dia", 0, dv}
	}
	u := "atrasada"
	if dv > d.DiasCredito {
		u = "urgente"
	}
	return Prioridad{u, d.Vencido * float64(dv), dv}
}

// EtiquetaDeUrgencia es cómo se muestra.
var EtiquetaDeUrgencia = map[string]string{"bloqueada": "Cuenta bloqueada", "urgente": "Llamar hoy", "atrasada": "Atrasado", "al-dia": "En término"}
