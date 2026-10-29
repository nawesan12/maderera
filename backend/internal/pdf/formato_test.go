package pdf

import (
	"encoding/json"
	"math"
	"os"
	"strconv"
	"testing"
	"time"
)

// Los formatos contra Intl de Node (scripts/golden/pdf.ts escribe
// formato.json con la zona de Argentina).
func TestFormatosComoIntl(t *testing.T) {
	crudo, err := os.ReadFile(dirGolden + "/formato.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		Moneda []struct {
			V json.RawMessage `json:"v"`
			S string          `json:"s"`
		} `json:"moneda"`
		Fechas []struct {
			Iso       time.Time `json:"iso"`
			Local     string    `json:"local"`
			SolaCorta string    `json:"solaCorta"`
			FechaHora string    `json:"fechaHora"`
		} `json:"fechas"`
	}
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	for _, c := range g.Moneda {
		var v float64
		var texto string
		if json.Unmarshal(c.V, &texto) == nil {
			switch texto {
			case "-0":
				v = math.Copysign(0, -1)
			case "NaN":
				v = math.NaN()
			case "Infinity":
				v = math.Inf(1)
			case "-Infinity":
				v = math.Inf(-1)
			}
		} else if v, err = strconv.ParseFloat(string(c.V), 64); err != nil {
			t.Fatal(err)
		}
		if got := Moneda(v); got != c.S {
			t.Errorf("Moneda(%s) = %q, Intl da %q", c.V, got, c.S)
		}
	}
	for _, c := range g.Fechas {
		if got := FechaLocal(c.Iso); got != c.Local {
			t.Errorf("FechaLocal(%s) = %q, Intl da %q", c.Iso, got, c.Local)
		}
		if got := FechaSolaCorta(c.Iso); got != c.SolaCorta {
			t.Errorf("FechaSolaCorta(%s) = %q, Intl da %q", c.Iso, got, c.SolaCorta)
		}
		if got := FechaHora(c.Iso); got != c.FechaHora {
			t.Errorf("FechaHora(%s) = %q, Intl da %q", c.Iso, got, c.FechaHora)
		}
	}
}

// El arreglo de la zona: el TS fecha «hoy» con la zona del proceso, y el
// contenedor de Next corre en UTC. A las 22:30 del 5/3 en Buenos Aires ya es
// 6/3 en UTC, y la lista decía «Vigente al 6/3/2026». Go fecha en Argentina.
func TestFechaDeHoyEnArgentina(t *testing.T) {
	noche := time.Date(2026, 3, 6, 1, 30, 0, 0, time.UTC) // 22:30 del 5/3 en Buenos Aires
	if got := FechaLocal(noche); got != "5/3/2026" {
		t.Errorf("FechaLocal = %q, quiero 5/3/2026", got)
	}
	if got := FechaCortaHoy(noche); got != "05/03/26" {
		t.Errorf("FechaCortaHoy = %q, quiero 05/03/26", got)
	}
	if got := FechaHora(noche); got != "5/3, 22:30" {
		t.Errorf("FechaHora = %q, quiero 5/3, 22:30", got)
	}
}

func TestLimpiar(t *testing.T) {
	for entrada, quiero := range map[string]string{
		"“Pino” 3’ — 2–4… ok": `"Pino" 3' - 2-4... ok`,
		"emoji 😀 y € y ™":     "emoji  y  y ",
		"ñandú ÁÉÍÓÚ ÿ":       "ñandú ÁÉÍÓÚ ÿ",
		"tab\tsalto\nfin":     "tabsaltofin",
	} {
		if got := Limpiar(entrada); got != quiero {
			t.Errorf("Limpiar(%q) = %q, quiero %q", entrada, got, quiero)
		}
	}
}
