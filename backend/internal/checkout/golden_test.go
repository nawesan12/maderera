package checkout

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"

	"mjbj/internal/jsmath"
	"mjbj/internal/ventas"
)

// Los golden de scripts/golden/checkout.ts:
//
//	TZ=America/Argentina/Buenos_Aires npx tsx scripts/golden/checkout.ts

func leerGolden(t *testing.T, nombre string, v any) {
	t.Helper()
	b, err := os.ReadFile("../../testdata/golden/checkout/" + nombre)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

func comoJSON(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestGoldenVolumen(t *testing.T) {
	var casos []struct {
		Escalas      []EscalaDeVolumen `json:"escalas"`
		Contexto     ContextoDescuento `json:"contexto"`
		Precio       float64           `json:"precio"`
		Porcentaje   float64           `json:"porcentaje"`
		ConDescuento float64           `json:"conDescuento"`
		PctDirecto   float64           `json:"pctDirecto"`
		Directo      float64           `json:"directo"`
	}
	leerGolden(t, "volumen.json", &casos)
	for i, c := range casos {
		p := DescuentoPorVolumen(c.Escalas, c.Contexto)
		if p != c.Porcentaje || PrecioConDescuento(c.Precio, p) != c.ConDescuento || PrecioConDescuento(c.Precio, c.PctDirecto) != c.Directo {
			t.Fatalf("%d: %v %v %v, el TS %+v", i, p, PrecioConDescuento(c.Precio, p), PrecioConDescuento(c.Precio, c.PctDirecto), c)
		}
	}
	if len(casos) < 4000 {
		t.Fatal("pocos casos")
	}
}

func TestGoldenCarrito(t *testing.T) {
	var casos []struct {
		Filas   []FilaDelCarrito  `json:"filas"`
		Cortes  []FilaDeCorte     `json:"cortes"`
		Escalas []EscalaDeVolumen `json:"escalas"`
		Lista   *string           `json:"lista"`
		Carrito any               `json:"carrito"`
	}
	leerGolden(t, "carrito.json", &casos)
	for i, c := range casos {
		got := comoJSON(t, ArmarCarrito("c", c.Filas, c.Cortes, c.Escalas, c.Lista))
		if !reflect.DeepEqual(got, c.Carrito) {
			t.Fatalf("%d:\n%v\nel TS\n%v", i, got, c.Carrito)
		}
	}
}

type resultado struct {
	Entrada map[string]any `json:"entrada"`
	Datos   map[string]any `json:"datos"`
	Error   string         `json:"error"`
	Campo   string         `json:"campo"`
}

func revisar(t *testing.T, i int, c resultado, datos any, e *ErrorDeFormulario) {
	t.Helper()
	if c.Error != "" || e != nil {
		if e == nil || e.Mensaje != c.Error || e.Campo != c.Campo {
			t.Fatalf("%d %v: %+v, el TS %q en %q", i, c.Entrada, e, c.Error, c.Campo)
		}
		return
	}
	if got := comoJSON(t, datos); !reflect.DeepEqual(got, any(c.Datos)) {
		t.Fatalf("%d %v:\n%v\nel TS\n%v", i, c.Entrada, got, c.Datos)
	}
}

func TestGoldenAgregar(t *testing.T) {
	var casos []resultado
	leerGolden(t, "agregar.json", &casos)
	for i, c := range casos {
		a, e := LeerAgregado(c.Entrada)
		m := map[string]any{"descripcion": a.Descripcion, "unidad": a.Unidad, "cantidad": a.Cantidad, "origen": a.Origen}
		if a.VariantID != nil {
			m["variantId"] = *a.VariantID
		}
		if a.HayPresentacion {
			m["presentacion"] = a.Presentacion
		}
		if a.Notas != nil {
			m["notas"] = *a.Notas
		}
		revisar(t, i, c, m, e)
	}
}

func TestGoldenPresupuesto(t *testing.T) {
	var casos []struct {
		resultado
		NotasGuardadas *string `json:"notasGuardadas"`
	}
	leerGolden(t, "presupuesto.json", &casos)
	for i, c := range casos {
		p, e := LeerPedidoDePresupuesto(c.Entrada)
		var fecha any
		if p.NecesitaPara != nil {
			fecha = p.NecesitaPara.UTC().Format("2006-01-02T15:04:05.000Z")
		}
		m := map[string]any{"nombre": p.Nombre, "email": p.Email, "telefono": p.Telefono, "necesitaPara": fecha, "motivos": p.Motivos}
		if p.SucursalID != nil {
			m["sucursalId"] = *p.SucursalID
		}
		if p.Notas != nil {
			m["notas"] = *p.Notas
		}
		revisar(t, i, c.resultado, m, e)
		if e == nil {
			if got := NotasDelPresupuesto(p.Motivos, p.Notas); !reflect.DeepEqual(got, c.NotasGuardadas) {
				t.Fatalf("%d: notas %v, el TS %v", i, got, c.NotasGuardadas)
			}
		}
	}
}

func TestGoldenCompra(t *testing.T) {
	var casos []resultado
	leerGolden(t, "compra.json", &casos)
	for i, c := range casos {
		d, e := LeerDatosDeCompra(c.Entrada)
		revisar(t, i, c, d, e)
	}
}

func TestGoldenBancarios(t *testing.T) {
	var casos []resultado
	leerGolden(t, "bancarios.json", &casos)
	for i, c := range casos {
		d, e := LeerDatosBancarios(c.Entrada)
		revisar(t, i, c, d, e)
	}
}

func TestGoldenCuentas(t *testing.T) {
	var casos []struct {
		Entrada struct {
			SubtotalItems  []float64 `json:"subtotalItems"`
			SubtotalCortes []float64 `json:"subtotalCortes"`
			Zona           *struct {
				Nombre           string  `json:"nombre"`
				Costo            float64 `json:"costo"`
				EnvioGratisDesde float64 `json:"envioGratisDesde"`
				ACotizar         bool    `json:"aCotizar"`
			} `json:"zona"`
			MedioPago         string                `json:"medioPago"`
			ListaDiferenciada bool                  `json:"listaDiferenciada"`
			Escalas           []ventas.EscalaDePago `json:"escalas"`
		} `json:"entrada"`
		Error       string  `json:"error"`
		Subtotal    string  `json:"subtotal"`
		CostoEnvio  string  `json:"costoEnvio"`
		NombreZona  *string `json:"nombreZona"`
		Descuento   string  `json:"descuento"`
		Total       string  `json:"total"`
		TotalNumero float64 `json:"totalNumero"`
	}
	leerGolden(t, "cuentas.json", &casos)
	for i, c := range casos {
		e := c.Entrada
		var z *Zona
		if e.Zona != nil {
			z = &Zona{e.Zona.Nombre, e.Zona.Costo, e.Zona.EnvioGratisDesde, e.Zona.ACotizar}
		}
		cu, msj := CuentasDeLaCompra(e.SubtotalItems, e.SubtotalCortes, z, e.MedioPago, e.ListaDiferenciada, e.Escalas)
		if msj != c.Error {
			t.Fatalf("%d: %q, el TS %q", i, msj, c.Error)
		}
		if msj != "" {
			continue
		}
		if jsmath.Fijo2(cu.Subtotal) != c.Subtotal || jsmath.Fijo2(cu.CostoEnvio) != c.CostoEnvio || jsmath.Fijo2(cu.Descuento) != c.Descuento ||
			jsmath.Fijo2(cu.Total) != c.Total || cu.Total != c.TotalNumero || !reflect.DeepEqual(cu.NombreZona, c.NombreZona) {
			t.Fatalf("%d: %+v, el TS %+v", i, cu, c)
		}
	}
}

func TestGoldenPlazos(t *testing.T) {
	var casos []struct {
		Desde, Express, DelDia time.Time
	}
	leerGolden(t, "plazos.json", &casos)
	for i, c := range casos {
		if e, d := VencimientoExpress(c.Desde), VencimientoDelDia(c.Desde); !e.Equal(c.Express) || !d.Equal(c.DelDia) {
			t.Fatalf("%d %v: %v %v, el TS %v %v", i, c.Desde, e, d, c.Express, c.DelDia)
		}
	}
}

func TestFechaDelDiaEnHoraArgentina(t *testing.T) {
	f, ok := FechaDelDia("2026-11-05")
	if !ok || !f.Equal(time.Date(2026, 11, 5, 15, 0, 0, 0, time.UTC)) {
		t.Fatalf("%v", f)
	}
}
