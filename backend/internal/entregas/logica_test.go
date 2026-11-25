package entregas

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"mjbj/internal/jsmath"
)

// Los golden de scripts/golden/entregas.ts: el TS de antes sobre los casos
// de siempre y miles al azar. Go tiene que dar lo mismo, exacto.

func leerGolden(t *testing.T, nombre string, v any) {
	t.Helper()
	crudo, err := os.ReadFile("../../testdata/golden/entregas/" + nombre)
	if err != nil {
		t.Fatalf("falta el golden (TZ=UTC npx tsx scripts/golden/entregas.ts): %v", err)
	}
	if err := json.Unmarshal(crudo, v); err != nil {
		t.Fatal(err)
	}
}

type fila struct {
	OrderItemID string `json:"orderItemId"`
	Descripcion string `json:"descripcion"`
	Unidad      string `json:"unidad"`
	Pedido      string `json:"pedido"`
	Entregado   string `json:"entregado"`
}

func renglones(fs []fila) []Renglon {
	out := make([]Renglon, len(fs))
	for i, f := range fs {
		out[i] = NuevoRenglon(f.OrderItemID, f.Descripcion, f.Unidad, f.Pedido, f.Entregado)
	}
	return out
}

func TestGoldenSaldos(t *testing.T) {
	var casos []struct {
		Filas     []fila    `json:"filas"`
		Renglones []Renglon `json:"renglones"`
		AlRemito  []Renglon `json:"alRemito"`
	}
	leerGolden(t, "saldos.json", &casos)
	for i, c := range casos {
		rs := renglones(c.Filas)
		if !reflect.DeepEqual(rs, c.Renglones) {
			t.Fatalf("caso %d: saldo %+v, el TS %+v", i, rs, c.Renglones)
		}
		if al := SoloPendientes(rs); !reflect.DeepEqual(al, c.AlRemito) {
			t.Fatalf("caso %d: al remito %+v, el TS %+v", i, al, c.AlRemito)
		}
	}
	t.Logf("%d saldos", len(casos))
}

func TestGoldenValidaciones(t *testing.T) {
	var casos []struct {
		Pendientes []Renglon        `json:"pendientes"`
		Lineas     []LineaAEntregar `json:"lineas"`
		Salida     struct {
			Error     string           `json:"error"`
			Lineas    []LineaAEntregar `json:"lineas"`
			Guardadas []string         `json:"guardadas"`
			Completo  bool             `json:"completo"`
		} `json:"salida"`
	}
	leerGolden(t, "validaciones.json", &casos)
	for i, c := range casos {
		r := ValidarEntrega(c.Pendientes, c.Lineas)
		if r.Error != c.Salida.Error || r.Completo != c.Salida.Completo || !reflect.DeepEqual(r.Lineas, c.Salida.Lineas) {
			t.Fatalf("caso %d: %+v, el TS %+v", i, r, c.Salida)
		}
		for j, l := range r.Lineas {
			if g := jsmath.ToFixed(l.Cantidad, 2); g != c.Salida.Guardadas[j] {
				t.Fatalf("caso %d: guardada %s, el TS %s", i, g, c.Salida.Guardadas[j])
			}
		}
	}
	t.Logf("%d validaciones", len(casos))
}

func TestGoldenConstancias(t *testing.T) {
	var casos []struct {
		Pendientes []Renglon `json:"pendientes"`
		Lineas     []struct {
			OrderItemID string `json:"orderItemId"`
			Cantidad    string `json:"cantidad"`
			Orden       int    `json:"orden"`
		} `json:"lineas"`
	}
	leerGolden(t, "constancias.json", &casos)
	for i, c := range casos {
		ls := LineasDeConstancia(c.Pendientes)
		if len(ls) != len(c.Lineas) {
			t.Fatalf("caso %d: %d líneas, el TS %d", i, len(ls), len(c.Lineas))
		}
		for j, l := range ls {
			if l.OrderItemID != c.Lineas[j].OrderItemID || jsmath.ToFixed(l.Cantidad, 2) != c.Lineas[j].Cantidad || j != c.Lineas[j].Orden {
				t.Fatalf("caso %d: %+v, el TS %+v", i, l, c.Lineas[j])
			}
		}
	}
}

func TestGoldenFormularioDelRemito(t *testing.T) {
	var casos []struct {
		Entrada map[string]any `json:"entrada"`
		Salida  struct {
			Error  string           `json:"error"`
			Data   map[string]any   `json:"data"`
			Lineas []LineaAEntregar `json:"lineas"`
		} `json:"salida"`
		Campo string `json:"campo"`
	}
	leerGolden(t, "remitos.json", &casos)
	errores := 0
	for i, c := range casos {
		f, campo, msj := LeerRemito(c.Entrada)
		if msj != c.Salida.Error || campo != c.Campo {
			t.Fatalf("caso %d (%v): %q en %q, el TS %q en %q", i, c.Entrada, msj, campo, c.Salida.Error, c.Campo)
		}
		if msj != "" {
			errores++
			continue
		}
		data := map[string]any{"orderId": f.OrderID, "tipo": f.Tipo}
		for k, v := range map[string]*string{"receptorNombre": f.ReceptorNombre, "receptorDocumento": f.ReceptorDocumento,
			"transportista": f.Transportista, "numeroSeguimiento": f.NumeroSeguimiento, "notas": f.Notas} {
			if v != nil {
				data[k] = *v
			}
		}
		if !reflect.DeepEqual(data, c.Salida.Data) {
			t.Fatalf("caso %d: %v, el TS %v", i, data, c.Salida.Data)
		}
		if len(f.Lineas) != len(c.Salida.Lineas) || (len(f.Lineas) > 0 && !reflect.DeepEqual(f.Lineas, c.Salida.Lineas)) {
			t.Fatalf("caso %d: líneas %v, el TS %v", i, f.Lineas, c.Salida.Lineas)
		}
	}
	t.Logf("%d formularios (%d con error)", len(casos), errores)
}

func TestGoldenFirma(t *testing.T) {
	var casos []struct {
		Entrada map[string]any `json:"entrada"`
		Salida  struct {
			Error string     `json:"error"`
			Campo string     `json:"campo"`
			Data  *FormFirma `json:"data"`
		} `json:"salida"`
	}
	leerGolden(t, "firmas.json", &casos)
	for i, c := range casos {
		f, campo, msj := LeerFirma(c.Entrada)
		if msj != c.Salida.Error || campo != c.Salida.Campo {
			t.Fatalf("caso %d: %q en %q, el TS %q en %q", i, msj, campo, c.Salida.Error, c.Salida.Campo)
		}
		if msj == "" && !reflect.DeepEqual(f, *c.Salida.Data) {
			t.Fatalf("caso %d: %+v, el TS %+v", i, f, *c.Salida.Data)
		}
	}
}

func TestGoldenZonas(t *testing.T) {
	var casos []struct {
		Entrada map[string]any `json:"entrada"`
		Salida  struct {
			Error       string        `json:"error"`
			ID          *string       `json:"id"`
			Valores     ValoresDeZona `json:"valores"`
			Descripcion string        `json:"descripcion"`
		} `json:"salida"`
		Campo string `json:"campo"`
	}
	leerGolden(t, "zonas.json", &casos)
	for i, c := range casos {
		z, campo, msj := LeerZona(c.Entrada)
		if msj != c.Salida.Error {
			t.Fatalf("caso %d (%v): %q, el TS %q", i, c.Entrada, msj, c.Salida.Error)
		}
		// El campo se compara cuando falló zod (los otros mensajes son de la
		// acción, sin campo).
		if c.Campo != "" && campo != c.Campo {
			t.Fatalf("caso %d: campo %q, el TS %q", i, campo, c.Campo)
		}
		if msj != "" {
			continue
		}
		if !reflect.DeepEqual(z.ID, c.Salida.ID) || !reflect.DeepEqual(z.Valores, c.Salida.Valores) || z.Descripcion != c.Salida.Descripcion {
			t.Fatalf("caso %d: %+v, el TS %+v", i, z, c.Salida)
		}
	}
}

// El arreglo: dos líneas del mismo renglón no pasan juntas de lo que queda.
func TestDosLineasDelMismoRenglonNoSuperanElSaldo(t *testing.T) {
	pendientes := []Renglon{{OrderItemID: "a", Descripcion: "Tirante", Pendiente: 6}}
	r := ValidarEntrega(pendientes, []LineaAEntregar{{"a", 5}, {"a", 5}})
	if r.Error != `De "Tirante" quedan 6 y estás entregando 10.` {
		t.Fatalf("dos líneas de 5 contra 6 pasaron: %+v", r)
	}
	if r := ValidarEntrega(pendientes, []LineaAEntregar{{"a", 3}, {"a", 3}}); r.Error != "" || !r.Completo {
		t.Fatalf("3 + 3 contra 6: %+v", r)
	}
}

func TestZonaFueraDeRango(t *testing.T) {
	for _, c := range []struct {
		costo, orden, campo string
	}{
		{"9.999.999.999,99", "1", ""},
		{"10.000.000.000", "1", "costo"},
		{"1", "9999", ""},
		{"1", "10000", "orden"},
		{"1", "-10000", "orden"},
		{"1", "1e300", "orden"},
	} {
		z, _, msj := LeerZona(map[string]any{"nombre": "Centro", "costo": c.costo, "orden": c.orden})
		if msj != "" {
			t.Fatal(msj)
		}
		if campo, _ := z.Valores.FueraDeRango(); campo != c.campo {
			t.Errorf("%+v: %q", c, campo)
		}
	}
}

// Lo que no se fracciona sale entero (T4, hallazgo 21): se entregó 0,01 de
// una bisagra y el stock quedó en 619,99.
func TestLoQueNoSeFraccionaSaleEntero(t *testing.T) {
	bisagra := Renglon{OrderItemID: "b", Descripcion: "Bisagra cazoleta", Unidad: "unidad", Pendiente: 620, Enteros: true}
	saldo := func(pendiente float64) Renglon {
		return Renglon{OrderItemID: "b", Descripcion: "Bisagra", Unidad: "unidad", Pendiente: pendiente, Enteros: true}
	}
	restado := NuevoRenglon("b", "Bisagra", "unidad", "620", "0.01")
	restado.Enteros = true
	casos := []struct {
		nombre     string
		pendientes []Renglon
		lineas     []LineaAEntregar
		error      string
	}{
		{"un centésimo de bisagra", []Renglon{bisagra}, []LineaAEntregar{{"b", 0.01}}, `"Bisagra cazoleta" se entrega en cantidades enteras.`},
		{"dos mitades que suman una fracción", []Renglon{bisagra}, []LineaAEntregar{{"b", 1.5}, {"b", 1}}, `"Bisagra cazoleta" se entrega en cantidades enteras.`},
		// La tolerancia de un centavo es para los metros: no deja sacar de más.
		{"un centésimo de más", []Renglon{bisagra}, []LineaAEntregar{{"b", 620.005}}, `De "Bisagra cazoleta" quedan 620 y estás entregando 620.005.`},
		{"entera", []Renglon{bisagra}, []LineaAEntregar{{"b", 20}}, ""},
		// El saldo fraccionario que ya existe se puede entregar entero.
		{"exactamente lo pendiente", []Renglon{saldo(619.99)}, []LineaAEntregar{{"b", 619.99}}, ""},
		{"lo pendiente, restado en coma flotante", []Renglon{restado}, []LineaAEntregar{{"b", 619.99}}, ""},
		{"menos que lo pendiente fraccionario", []Renglon{saldo(619.99)}, []LineaAEntregar{{"b", 600.5}}, `"Bisagra" se entrega en cantidades enteras.`},
		{"media placa", []Renglon{{OrderItemID: "p", Descripcion: "MDF 18", Unidad: "placa", Pendiente: 3}}, []LineaAEntregar{{"p", 0.5}}, ""},
		{"metros con decimales", []Renglon{{OrderItemID: "m", Descripcion: "Zócalo", Unidad: "metro_lineal", Pendiente: 28.8}}, []LineaAEntregar{{"m", 12.4}}, ""},
		// Una línea cargada a mano no tiene producto: su unidad es texto libre.
		{"tapacanto cargado a mano", []Renglon{{OrderItemID: "t", Descripcion: "Tapacanto pegado", Unidad: "m", Pendiente: 3.6}}, []LineaAEntregar{{"t", 1.2}}, ""},
	}
	for _, c := range casos {
		if got := RevisarEnteros(c.pendientes, c.lineas); got != c.error {
			t.Errorf("%s: %q, quería %q", c.nombre, got, c.error)
		}
	}
}
