package cobros

import (
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"
)

type golden struct {
	Partes []struct {
		Partes []struct {
			Medio    Medio
			Importe  any
			ChequeID *string `json:"chequeId"`
			Cheque   *struct {
				Numero, Banco string
				FechaPago     string `json:"fechaPago"`
			}
		}
		Circuito *string
		Problema *string
		Total    float64
	}
	Totales []struct {
		Importes []float64
		Total    float64
	}
	Centavos []struct{ V, R float64 }
	Letras   []struct {
		V float64
		R string
	}
	Lecturas []struct {
		Crudo  any
		Error  *string
		Partes []struct {
			Medio      Medio
			Importe    any
			Referencia *string
			ChequeID   *string `json:"chequeId"`
			Cheque     *struct {
				Numero, Banco string
				Librador      *string
				FechaPago     string `json:"fechaPago"`
			}
		}
	}
	Transiciones []struct {
		Desde, Hacia Estado
		Puede        bool
		Efecto       string
	}
	Numeros []struct {
		T, Normal string
		Problema  *string
	}
	Nombres []struct {
		C struct {
			Tipo   *string
			Banco  *string
			Numero string
		}
		R string
	}
	Hoy    time.Time
	Agings []struct {
		Movimientos []struct {
			Monto float64
			Fecha time.Time
		}
		R Aging
	}
	Prioridades []struct {
		D struct {
			Vencido          float64
			DiasDeLaMasVieja *int
			DiasCredito      int
			Bloqueada        bool
		}
		R Prioridad
	}
}

func leer(t *testing.T) golden {
	crudo, err := os.ReadFile("../../testdata/golden/cuentas/logica.json")
	if err != nil {
		t.Fatal(err)
	}
	var g golden
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func numero(v any) float64 {
	if s, ok := v.(string); ok && s == "NaN" {
		return math.NaN()
	}
	return v.(float64)
}

func TestPartesComoTS(t *testing.T) {
	g := leer(t)
	for i, c := range g.Partes {
		var partes []Parte
		var validos []float64
		for _, p := range c.Partes {
			x := Parte{Medio: p.Medio, Importe: numero(p.Importe), ChequeID: p.ChequeID}
			if p.Cheque != nil {
				f, _ := time.Parse("2006-01-02", p.Cheque.FechaPago)
				x.Cheque = &ChequeNuevo{Numero: p.Cheque.Numero, Banco: p.Cheque.Banco, FechaPago: f}
			}
			partes = append(partes, x)
			if !math.IsNaN(x.Importe) {
				validos = append(validos, x.Importe)
			}
		}
		circ := ""
		if c.Circuito != nil {
			circ = *c.Circuito
		}
		esperado := ""
		if c.Problema != nil {
			esperado = *c.Problema
		}
		if r := Revisar(partes, circ); r != esperado {
			t.Errorf("caso %d: Go %q, TS %q", i, r, esperado)
		}
		if len(partes) > 0 {
			if r := TotalDePartes(validos); r != c.Total {
				t.Errorf("caso %d total: Go %v, TS %v", i, r, c.Total)
			}
		}
	}
	for _, c := range g.Totales {
		if r := TotalDePartes(c.Importes); r != c.Total {
			t.Errorf("total de %v: Go %v, TS %v", c.Importes, r, c.Total)
		}
	}
	for _, c := range g.Centavos {
		if r := ACentavos(c.V); r != c.R {
			t.Errorf("aCentavos(%v) = %v, TS %v", c.V, r, c.R)
		}
	}
	for _, c := range g.Letras {
		if r := ImporteEnLetras(c.V); r != c.R {
			t.Errorf("letras(%v) = %q, TS %q", c.V, r, c.R)
		}
	}
}

func TestLeerPartesComoTS(t *testing.T) {
	g := leer(t)
	for i, c := range g.Lecturas {
		crudo, _ := c.Crudo.(string)
		partes, e := LeerPartes(crudo)
		if c.Error != nil {
			if e != *c.Error {
				t.Errorf("lectura %d: Go %q, TS %q", i, e, *c.Error)
			}
			continue
		}
		if e != "" || len(partes) != len(c.Partes) {
			t.Errorf("lectura %d: Go %v %q, TS %v", i, partes, e, c.Partes)
			continue
		}
		for j, p := range c.Partes {
			x := partes[j]
			imp := numero(p.Importe)
			if x.Medio != p.Medio || !(x.Importe == imp || (math.IsNaN(x.Importe) && math.IsNaN(imp))) ||
				(x.Referencia == nil) != (p.Referencia == nil) || (x.Cheque == nil) != (p.Cheque == nil) {
				t.Errorf("lectura %d parte %d: Go %+v, TS %+v", i, j, x, p)
			}
			if p.Cheque != nil && (x.Cheque.Numero != p.Cheque.Numero || x.Cheque.Banco != p.Cheque.Banco ||
				x.Cheque.FechaPago.UTC().Format(time.RFC3339) != p.Cheque.FechaPago[:19]+"Z") {
				t.Errorf("lectura %d cheque: Go %+v, TS %+v", i, *x.Cheque, *p.Cheque)
			}
		}
	}
}

func TestChequesComoTS(t *testing.T) {
	g := leer(t)
	for _, c := range g.Transiciones {
		if PuedePasar(c.Desde, c.Hacia) != c.Puede || Efecto(c.Desde, c.Hacia) != c.Efecto {
			t.Errorf("%s → %s: Go (%v, %s), TS (%v, %s)", c.Desde, c.Hacia, PuedePasar(c.Desde, c.Hacia), Efecto(c.Desde, c.Hacia), c.Puede, c.Efecto)
		}
	}
	for _, c := range g.Numeros {
		esperado := ""
		if c.Problema != nil {
			esperado = *c.Problema
		}
		if NormalizarNumeroDeCheque(c.T) != c.Normal || RevisarNumeroDeCheque(c.T) != esperado {
			t.Errorf("número %q: Go (%q, %q)", c.T, NormalizarNumeroDeCheque(c.T), RevisarNumeroDeCheque(c.T))
		}
	}
	for _, c := range g.Nombres {
		tipo := ""
		if c.C.Tipo != nil {
			tipo = *c.C.Tipo
		}
		if r := NombreDelCheque(tipo, c.C.Banco, c.C.Numero); r != c.R {
			t.Errorf("nombre: Go %q, TS %q", r, c.R)
		}
	}
}

func TestAgingYPrioridadComoTS(t *testing.T) {
	g := leer(t)
	mal := 0
	for i, c := range g.Agings {
		movs := make([]Movimiento, len(c.Movimientos))
		for j, m := range c.Movimientos {
			movs[j] = Movimiento{m.Monto, m.Fecha}
		}
		r := CalcularAging(movs, g.Hoy)
		a, _ := json.Marshal(r)
		b, _ := json.Marshal(c.R)
		if string(a) != string(b) {
			if mal++; mal < 5 {
				t.Errorf("aging %d:\nGo %s\nTS %s", i, a, b)
			}
		}
	}
	for _, c := range g.Prioridades {
		r := PrioridadDeCobranza(Deuda{c.D.Vencido, c.D.DiasDeLaMasVieja, c.D.DiasCredito, c.D.Bloqueada})
		if r != c.R {
			t.Errorf("prioridad %+v: Go %+v, TS %+v", c.D, r, c.R)
		}
	}
}

// Bug: la cuenta en coma flotante dejaba restos. Dos pagos de 0,70 y -0,40
// (una nota de débito) dejan 0,29999999999999998 a favor; una compra de 0,30
// quedaba con 5,5e-17 pendientes y la cuenta, con saldo real cero, decía
// «Tiene deuda de hace 198 días».
func TestAgingSinRestosDeComaFlotante(t *testing.T) {
	hace := func(d int) time.Time { return time.Date(2026, 4, 15, 12, 0, 0, 0, time.UTC).AddDate(0, 0, -d) }
	hoy := hace(0)
	movs := []Movimiento{
		{-0.7, hace(200)},
		{0.4, hace(199)},
		{0.3, hace(198)},
	}
	a := CalcularAging(movs, hoy)
	if a.DiasDeLaMasVieja != nil || a.Total != 0 || a.AFavor != 0 {
		t.Errorf("saldo cero sin deuda: %+v (días %v)", a, a.DiasDeLaMasVieja)
	}
	// Y al revés: un resto a favor de 1e-17 no es saldo a favor.
	movs = []Movimiento{{0.3, hace(10)}, {-0.1, hace(9)}, {-0.2, hace(8)}}
	a = CalcularAging(movs, hoy)
	if a.DiasDeLaMasVieja != nil || a.Total != 0 || a.AFavor != 0 {
		t.Errorf("pagado justo: %+v", a)
	}
}
