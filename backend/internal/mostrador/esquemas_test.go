package mostrador

import (
	"encoding/json"
	"os"
	"testing"

	"mjbj/internal/zodjs"
)

// Los esquemas de zod de cada puerta del mostrador, contra el golden de
// scripts/golden/mostrador.ts: mismo primer error (mensaje y ruta), o que
// pasó, con los datos ya transformados (trim, defaults, coerce).

type casoEsquema struct {
	Entrada json.RawMessage `json:"entrada"`
	Ok      bool            `json:"ok"`
	Ruta    string          `json:"ruta"`
	Error   string          `json:"error"`
	Datos   map[string]any  `json:"datos"`
}

func leerEsquemas(t *testing.T) map[string][]casoEsquema {
	t.Helper()
	crudo, err := os.ReadFile("../../testdata/golden/mostrador/esquemas.json")
	if err != nil {
		t.Fatal(err)
	}
	var g map[string][]casoEsquema
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func entrada(t *testing.T, c casoEsquema) any {
	var v any
	if len(c.Entrada) == 0 {
		return nil
	}
	if err := json.Unmarshal(c.Entrada, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func revisar(t *testing.T, nombre string, i int, c casoEsquema, l *zodjs.Lector) bool {
	t.Helper()
	ruta, msj := l.Primero()
	if c.Ok {
		if msj != "" {
			t.Fatalf("%s %d: Go rechaza (%s: %s) y el TS acepta: %s", nombre, i, ruta, msj, c.Entrada)
		}
		return true
	}
	if msj != c.Error || ruta != c.Ruta {
		t.Fatalf("%s %d: Go %q en %q, el TS %q en %q: %s", nombre, i, msj, ruta, c.Error, c.Ruta, c.Entrada)
	}
	return false
}

func TestGoldenEsquemas(t *testing.T) {
	g := leerEsquemas(t)
	total := 0
	for i, c := range g["ventaAccion"] {
		v, l := LeerVentaDeAccion(entrada(t, c))
		if revisar(t, "ventaAccion", i, c, l) {
			if v.Comprobante != c.Datos["comprobante"] {
				t.Fatalf("ventaAccion %d: comprobante %q", i, v.Comprobante)
			}
			for j, li := range v.Lineas {
				if li.Unidad != c.Datos["lineas"].([]any)[j].(map[string]any)["unidad"] {
					t.Fatalf("ventaAccion %d: unidad", i)
				}
			}
			if k, ok := c.Datos["corte"].(map[string]any); ok {
				if v.Corte == nil || v.Corte.MaterialDescripcion != k["materialDescripcion"] {
					t.Fatalf("ventaAccion %d: corte %+v", i, v.Corte)
				}
				if x, ok := k["placaAnchoMm"].(float64); ok && (v.Corte.PlacaAnchoMm == nil || float64(*v.Corte.PlacaAnchoMm) != x) {
					t.Fatalf("ventaAccion %d: placaAnchoMm", i)
				}
				for j, p := range k["piezas"].([]any) {
					m := p.(map[string]any)
					if float64(v.Corte.Piezas[j].AnchoMm) != m["anchoMm"].(float64) {
						t.Fatalf("ventaAccion %d: pieza %d", i, j)
					}
					if e, ok := m["etiqueta"].(string); ok && (v.Corte.Piezas[j].Etiqueta == nil || *v.Corte.Piezas[j].Etiqueta != e) {
						t.Fatalf("ventaAccion %d: etiqueta", i)
					}
				}
			}
			for j, p := range v.Pagos {
				m := c.Datos["pagos"].([]any)[j].(map[string]any)
				if ch, ok := m["cheque"].(map[string]any); ok {
					if p.Cheque == nil || p.Cheque.Tipo != ch["tipo"] || p.Cheque.Banco != ch["banco"] || p.Cheque.Numero != ch["numero"] {
						t.Fatalf("ventaAccion %d: cheque %+v", i, p.Cheque)
					}
				}
				if cu, ok := m["cuotas"].(float64); ok && (p.Cuotas == nil || *p.Cuotas != cu) {
					t.Fatalf("ventaAccion %d: cuotas", i)
				}
			}
		}
		total++
	}
	for i, c := range g["cuerpoCola"] {
		lote, l := LeerLoteDeLaCola(entrada(t, c))
		if revisar(t, "cuerpoCola", i, c, l) {
			vs := c.Datos["ventas"].([]any)
			if len(lote) != len(vs) {
				t.Fatalf("cuerpoCola %d: %d ventas", i, len(lote))
			}
			for j, v := range lote {
				m := vs[j].(map[string]any)
				if v.Comprobante != m["comprobante"] || v.CobradaAt == nil || *v.NumeroProvisorio != m["numeroProvisorio"] {
					t.Fatalf("cuerpoCola %d: venta %d %+v", i, j, v)
				}
				for k, li := range v.Lineas {
					if li.Unidad != m["lineas"].([]any)[k].(map[string]any)["unidad"] {
						t.Fatalf("cuerpoCola %d: unidad", i)
					}
				}
			}
		}
		total++
	}
	for i, c := range g["movimientoCaja"] {
		_, l := LeerMovimientoDiferido(entrada(t, c))
		revisar(t, "movimientoCaja", i, c, l)
		total++
	}
	for i, c := range g["presupuestoMostrador"] {
		_, l := LeerPresupuesto(entrada(t, c))
		revisar(t, "presupuestoMostrador", i, c, l)
		total++
	}
	for i, c := range g["altaRapida"] {
		a, l := LeerAltaRapida(entrada(t, c))
		if revisar(t, "altaRapida", i, c, l) {
			if a.Nombre != c.Datos["nombre"] || a.Documento != c.Datos["documento"] {
				t.Fatalf("altaRapida %d: %+v", i, a)
			}
			if tel, ok := c.Datos["telefono"].(string); ok && (a.Telefono == nil || *a.Telefono != tel) {
				t.Fatalf("altaRapida %d: teléfono", i)
			}
		}
		total++
	}
	if total < 9000 {
		t.Fatalf("pocos casos: %d", total)
	}
}
