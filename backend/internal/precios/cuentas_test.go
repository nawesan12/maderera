package precios

import (
	"encoding/json"
	"math"
	"os"
	"testing"

	"mjbj/internal/jsmath"
)

func TestCuentasComoTS(t *testing.T) {
	crudo, err := os.ReadFile("../../testdata/golden/precios/cuentas.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		Ajustes []struct {
			Base, Porcentaje float64
			Modo, Resultado  string
		}
		Costos []struct {
			Costo     float64
			Recargo   *float64
			Resultado float64
		}
		ToFixed []struct {
			V float64
			R string
		}
		Brechas []struct {
			G, P float64
			R    *float64
		}
		Importes          []struct{ T, R string }
		PorcentajesAjuste []struct {
			T     string
			Error *string
			Valor *float64
		}
		PorcentajesLista []struct {
			T        string
			Error    *string
			Valor    *float64
			Guardado *string
		}
	}
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	mal := 0
	for _, c := range g.Ajustes {
		if r := jsmath.Fijo2(Ajustar(c.Base, Factor(c.Porcentaje), c.Modo)); r != c.Resultado {
			if mal++; mal < 10 {
				t.Errorf("ajustar(%v, %v%%, %s) = %s, TS %s", c.Base, c.Porcentaje, c.Modo, r, c.Resultado)
			}
		}
	}
	for _, c := range g.Costos {
		if r := CostoElaborado(c.Costo, c.Recargo); r != c.Resultado {
			t.Errorf("costo %v + %v%% = %v, TS %v", c.Costo, c.Recargo, r, c.Resultado)
		}
	}
	for _, c := range g.ToFixed {
		if r := jsmath.Fijo2(c.V); r != c.R {
			t.Errorf("toFixed(%v) = %s, TS %s", c.V, r, c.R)
		}
	}
	for _, c := range g.Brechas {
		r := Brecha(c.G, c.P)
		if (r == nil) != (c.R == nil) || (r != nil && *r != *c.R) {
			t.Errorf("brecha(%v, %v) = %v, TS %v", c.G, c.P, r, c.R)
		}
	}
	for _, c := range g.Importes {
		r := ParsearImporte(c.T)
		texto := jsmath.Texto(r)
		if math.IsNaN(r) {
			texto = "NaN"
		}
		if texto != c.R {
			t.Errorf("parsearImporte(%q) = %s, TS %s", c.T, texto, c.R)
		}
	}
	for _, c := range g.PorcentajesAjuste {
		v, e := PorcentajeDeAjuste(c.T)
		if (c.Error == nil) != (e == "") || (c.Error != nil && *c.Error != e) || (c.Valor != nil && *c.Valor != v) {
			t.Errorf("porcentaje de ajuste %q: Go (%v, %q), zod (%v, %v)", c.T, v, e, c.Valor, c.Error)
		}
	}
	for _, c := range g.PorcentajesLista {
		v, e := PorcentajeDeLista(c.T)
		if (c.Error == nil) != (e == "") || (c.Error != nil && *c.Error != e) || (c.Guardado != nil && jsmath.Fijo2(v) != *c.Guardado) {
			t.Errorf("porcentaje de lista %q: Go (%v, %q), zod (%v, %v)", c.T, v, e, c.Guardado, c.Error)
		}
	}
	t.Logf("%d ajustes comparados, %d distintos", len(g.Ajustes), mal)
}
