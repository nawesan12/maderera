package pedidos

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"

	"mjbj/internal/reservas"
)

// Los golden de scripts/golden/pedidos.ts:
//
//	npx tsx scripts/golden/pedidos.ts

func leerGolden(t *testing.T, nombre string, v any) {
	t.Helper()
	b, err := os.ReadFile("../../testdata/golden/pedidos/" + nombre)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

func TestGoldenPlazo(t *testing.T) {
	var casos []struct {
		Ms int64 `json:"ms"`
		Plazo
	}
	leerGolden(t, "plazo.json", &casos)
	ahora := time.Date(2026, 10, 29, 15, 0, 0, 0, time.UTC)
	for _, c := range casos {
		if got := EstadoDelPlazo(ahora.Add(time.Duration(c.Ms)*time.Millisecond), ahora); got != c.Plazo {
			t.Errorf("%d ms: %+v, el TS %+v", c.Ms, got, c.Plazo)
		}
	}
	if len(casos) < 4000 {
		t.Fatalf("pocos casos: %d", len(casos))
	}
}

func TestGoldenMargen(t *testing.T) {
	var casos []struct {
		Items []struct {
			Subtotal      string  `json:"subtotal"`
			Cantidad      string  `json:"cantidad"`
			AlicuotaIva   *string `json:"alicuotaIva"`
			CostoUnitario *string `json:"costoUnitario"`
		} `json:"items"`
		Margen *Margen `json:"margen"`
	}
	leerGolden(t, "margen.json", &casos)
	for i, c := range casos {
		items := make([]LineaConCosto, len(c.Items))
		for j, it := range c.Items {
			items[j] = LineaConCosto{it.Subtotal, it.Cantidad, it.AlicuotaIva, it.CostoUnitario}
		}
		got := MargenDelPedido(items)
		if !reflect.DeepEqual(got, c.Margen) {
			t.Errorf("caso %d: %+v, el TS %+v", i, got, c.Margen)
		}
	}
}

func TestGoldenCostoCongelado(t *testing.T) {
	var casos []struct {
		Costo     *string `json:"costo"`
		Factor    float64 `json:"factor"`
		Resultado *string `json:"resultado"`
	}
	leerGolden(t, "costo.json", &casos)
	for _, c := range casos {
		got := reservas.CostoPorUnidadDeVenta(c.Costo, c.Factor)
		if (got == nil) != (c.Resultado == nil) || (got != nil && *got != *c.Resultado) {
			t.Errorf("%v × %v: %v, el TS %v", c.Costo, c.Factor, got, c.Resultado)
		}
	}
}

func TestGoldenAltaDePresupuesto(t *testing.T) {
	var casos []struct {
		Entrada   map[string]any `json:"entrada"`
		Lineas    []any          `json:"lineas"`
		Resultado struct {
			Error    *string                `json:"error"`
			Campo    string                 `json:"campo"`
			Cabecera *CabeceraDePresupuesto `json:"cabecera"`
			Lineas   []LineaDePresupuesto   `json:"lineas"`
			Subtotal string                 `json:"subtotal"`
			Items    []ImportesDeLinea      `json:"items"`
		} `json:"resultado"`
	}
	leerGolden(t, "crear.json", &casos)
	validos := 0
	for i, c := range casos {
		alta, e := LeerAltaDePresupuesto(c.Entrada, c.Lineas)
		r := c.Resultado
		if r.Error != nil {
			if e == nil || e.Mensaje != *r.Error || e.Campo != r.Campo {
				t.Errorf("caso %d: %+v, el TS %q en %q (%v)", i, e, *r.Error, r.Campo, c.Entrada)
			}
			continue
		}
		validos++
		if e != nil {
			t.Errorf("caso %d: %+v, el TS lo aceptó (%v %v)", i, e, c.Entrada, c.Lineas)
			continue
		}
		if !reflect.DeepEqual(alta.Cabecera, *r.Cabecera) || !reflect.DeepEqual(alta.Lineas, r.Lineas) ||
			alta.Subtotal != r.Subtotal || !reflect.DeepEqual(alta.Items, r.Items) {
			t.Errorf("caso %d:\n go %+v %+v %s %+v\n ts %+v %+v %s %+v", i, alta.Cabecera, alta.Lineas, alta.Subtotal, alta.Items,
				*r.Cabecera, r.Lineas, r.Subtotal, r.Items)
		}
	}
	if validos < 1000 {
		t.Fatalf("pocos válidos: %d", validos)
	}
}
