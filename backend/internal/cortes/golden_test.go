package cortes

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"reflect"
	"testing"
	"time"
)

// Los golden los genera el TS de verdad:
//
//	TZ=America/Argentina/Buenos_Aires npx tsx --tsconfig tsconfig.json scripts/golden/cortes.ts
const dirGolden = "../../testdata/golden/cortes/"

func leerGolden(t *testing.T, nombre string, destino any) {
	t.Helper()
	crudo, err := os.ReadFile(dirGolden + nombre)
	if err != nil {
		t.Fatal(err)
	}
	z, err := gzip.NewReader(bytes.NewReader(crudo))
	if err != nil {
		t.Fatal(err)
	}
	datos, err := io.ReadAll(z)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(datos, destino); err != nil {
		t.Fatal(err)
	}
}

// igualJSON compara lo que dio Go con lo que dio el TS, pasando los dos por
// JSON: mismos campos, mismos valores, números exactos.
func igualJSON(t *testing.T, donde string, gotGo any, delTS json.RawMessage) bool {
	t.Helper()
	b, err := json.Marshal(gotGo)
	if err != nil {
		t.Fatalf("%s: %v", donde, err)
	}
	var a, e any
	if err := json.Unmarshal(b, &a); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(delTS, &e); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a, e) {
		t.Errorf("%s: distinto\n go: %.600s\n ts: %.600s", donde, b, delTS)
		return false
	}
	return true
}

type datosGolden struct {
	Piezas      []PiezaAcortar `json:"piezas"`
	PlacaLargo  float64        `json:"placaLargo"`
	PlacaAncho  float64        `json:"placaAncho"`
	AnchoSierra *float64       `json:"anchoSierra"`
	Fijadas     []PiezaFijada  `json:"fijadas"`
	Busqueda    *bool          `json:"busqueda"`
	Semilla     *uint32        `json:"semilla"`
	Presupuesto *float64       `json:"presupuesto"`
}

func (d datosGolden) motor() DatosDelPlano {
	return DatosDelPlano{d.Piezas, d.PlacaLargo, d.PlacaAncho, d.AnchoSierra, d.Fijadas, d.Busqueda, d.Semilla, d.Presupuesto}
}

func TestGoldenPlanos(t *testing.T) {
	var casos []struct {
		Datos       datosGolden     `json:"datos"`
		Plano       json.RawMessage `json:"plano"`
		Superficies []float64       `json:"superficies"`
		Hoja        json.RawMessage `json:"hoja"`
		HojaError   string          `json:"hojaError"`
		Ptx         string          `json:"ptx"`
		Trabajo     *struct {
			Numero, Cliente, Material string
			CreatedAt                 time.Time
		} `json:"trabajo"`
	}
	leerGolden(t, "planos.json.gz", &casos)
	if len(casos) < 1000 {
		t.Fatalf("muy pocos casos: %d", len(casos))
	}
	fallas := 0
	for i, c := range casos {
		if fallas > 5 {
			t.Fatal("demasiadas diferencias")
		}
		plano := CalcularPlano(c.Datos.motor())
		if !igualJSON(t, fmt.Sprintf("caso %d: plano", i), plano, c.Plano) {
			fallas++
			continue
		}
		for k, p := range plano.Placas {
			if s := SuperficieDeSierra(p.Cortes, plano.AnchoSierra); s != c.Superficies[k] {
				t.Errorf("caso %d placa %d: sierra %v, TS %v", i, k, s, c.Superficies[k])
			}
		}
		hoja, err := ArmarHojaDeCorte(plano)
		if c.HojaError != "" {
			if err == nil || err.Error() != c.HojaError {
				t.Errorf("caso %d: error %v, TS %q", i, err, c.HojaError)
			}
			continue
		}
		if err != nil {
			t.Errorf("caso %d: %v", i, err)
			continue
		}
		if !igualJSON(t, fmt.Sprintf("caso %d: hoja", i), hoja, c.Hoja) {
			fallas++
			continue
		}
		if c.Trabajo != nil {
			piezas := make([]PiezaPtx, len(c.Datos.Piezas))
			for k, p := range c.Datos.Piezas {
				piezas[k] = PiezaPtx{p.LargoMm, p.AnchoMm, p.Cantidad, p.RespetaVeta, p.Etiqueta}
			}
			ptx := ArmarPtx(TrabajoParaPtx{c.Trabajo.Numero, c.Trabajo.Cliente, c.Trabajo.Material, c.Trabajo.CreatedAt, piezas}, hoja)
			if ptx != c.Ptx {
				fallas++
				t.Errorf("caso %d: PTX distinto\n go: %q\n ts: %q", i, ptx, c.Ptx)
			}
		}
	}
}

func TestGoldenSueltos(t *testing.T) {
	var g struct {
		Acomodos []struct {
			Crudo   *string         `json:"crudo"`
			Fijadas json.RawMessage `json:"fijadas"`
		} `json:"acomodos"`
		Listas []struct {
			Corte   CorteParaExportar   `json:"corte"`
			Perfil  PerfilDeExportacion `json:"perfil"`
			Archivo string              `json:"archivo"`
			Nombre  string              `json:"nombre"`
		} `json:"listas"`
		Medidas []struct {
			Mm      float64 `json:"mm"`
			Unidad  string  `json:"unidad"`
			Decimal string  `json:"decimal"`
			Texto   string  `json:"texto"`
		} `json:"medidas"`
		Tarifas []struct {
			Candidatos []string        `json:"candidatos"`
			Lista      *string         `json:"lista"`
			Tarifa     json.RawMessage `json:"tarifa"`
		} `json:"tarifas"`
		Cargos []struct {
			Tarifa  *TarifaDeCorte       `json:"tarifa"`
			Pasadas float64              `json:"pasadas"`
			Piezas  []PiezaPresupuestada `json:"piezas"`
			Corte   float64              `json:"corte"`
			Metros  float64              `json:"metros"`
			Canto   float64              `json:"canto"`
		} `json:"cargos"`
		Presupuestos []struct {
			Plano    Plano                `json:"plano"`
			Tarifa   *TarifaDeCorte       `json:"tarifa"`
			Precio   *float64             `json:"precio"`
			Piezas   []PiezaPresupuestada `json:"piezas"`
			Fraccion float64              `json:"fraccion"`
			Cuenta   json.RawMessage      `json:"cuenta"`
		} `json:"presupuestos"`
		Placas []struct {
			Args   map[string]any  `json:"args"`
			Medida json.RawMessage `json:"medida"`
			Nombre string          `json:"nombre"`
		} `json:"placas"`
		Sierras []struct {
			Texto string   `json:"texto"`
			Mm    *float64 `json:"mm"`
		} `json:"sierras"`
		Calculadoras []struct {
			P          ParametrosDeCalculo `json:"p"`
			Largo      float64             `json:"largo"`
			Ancho      float64             `json:"ancho"`
			Tipo       string              `json:"tipo"`
			Material   string              `json:"material"`
			Piezas     []PiezaDePlaca      `json:"piezas"`
			PlacaAncho float64             `json:"placaAncho"`
			PlacaLargo float64             `json:"placaLargo"`
			Techo      json.RawMessage     `json:"techo"`
			Placas     json.RawMessage     `json:"placas"`
			Piso       json.RawMessage     `json:"piso"`
			Deck       json.RawMessage     `json:"deck"`
		} `json:"calculadoras"`
		Textos []struct {
			Texto, Ptx, Ptx25 string
		} `json:"textos"`
		Nombres []struct {
			Numero, Nombre string
		} `json:"nombres"`
		Espesores []struct {
			Material string   `json:"material"`
			Espesor  *float64 `json:"espesor"`
		} `json:"espesores"`
	}
	leerGolden(t, "sueltos.json.gz", &g)

	for i, a := range g.Acomodos {
		crudo := ""
		if a.Crudo != nil {
			crudo = *a.Crudo
		}
		igualJSON(t, fmt.Sprintf("acomodo %d", i), LeerAcomodoManual(crudo), a.Fijadas)
	}
	for i, l := range g.Listas {
		if got := ArmarArchivoDeCorte(l.Corte, l.Perfil); got != l.Archivo {
			t.Errorf("lista %d:\n go: %q\n ts: %q", i, got, l.Archivo)
		}
		if got := NombreDeArchivo(l.Corte.Numero, l.Perfil.Separador); got != l.Nombre {
			t.Errorf("nombre %d: %q, TS %q", i, got, l.Nombre)
		}
	}
	for _, m := range g.Medidas {
		if got := ConvertirMedida(m.Mm, m.Unidad, m.Decimal); got != m.Texto {
			t.Errorf("medida %v %s %s: %q, TS %q", m.Mm, m.Unidad, m.Decimal, got, m.Texto)
		}
	}
	tarifas := []TarifaDeCorte{
		{"Placas", nil, 1200, 850.5}, {"Placas", ptr("may"), 996, 0}, {"Tableros de madera", nil, 1400, 0},
		{"  Fenólicos  ", ptr("may"), 1162.33, 10.1}, {"Melamína", nil, 1.005, 2.675},
	}
	for i, c := range g.Tarifas {
		igualJSON(t, fmt.Sprintf("tarifa %d", i), BuscarTarifa(tarifas, c.Candidatos, c.Lista), c.Tarifa)
	}
	for i, c := range g.Cargos {
		conCanto := make([]PiezaConCanto, len(c.Piezas))
		for k, p := range c.Piezas {
			conCanto[k] = PiezaConCanto{p.LargoMm, p.AnchoMm, p.Cantidad, p.CantoLargo, p.CantoAncho}
		}
		if got := CargoPorCorte(c.Tarifa, c.Pasadas); got != c.Corte {
			t.Errorf("cargo %d: %v, TS %v", i, got, c.Corte)
		}
		if got := MetrosDeTapacanto(conCanto); got != c.Metros {
			t.Errorf("metros %d: %v, TS %v", i, got, c.Metros)
		}
		if got := CargoPorTapacanto(c.Tarifa, c.Metros); got != c.Canto {
			t.Errorf("canto %d: %v, TS %v", i, got, c.Canto)
		}
	}
	for i, c := range g.Presupuestos {
		igualJSON(t, fmt.Sprintf("presupuesto %d", i), Presupuestar(c.Plano, c.Tarifa, c.Precio, c.Piezas, c.Fraccion), c.Cuenta)
	}
	for i, c := range g.Placas {
		num := func(k string) *float64 {
			switch v := c.Args[k].(type) {
			case float64:
				return &v
			case string:
				n := math.NaN()
				return &n
			}
			return nil
		}
		var mitad *string
		if m, ok := c.Args["mitad"].(string); ok {
			mitad = &m
		}
		igualJSON(t, fmt.Sprintf("placa %d", i), ResolverMedida(num("propiaLargo"), num("propiaAncho"), num("varianteLargo"), num("varianteAncho"), mitad), c.Medida)
		if got := NombreDeLaMitad(mitad); got != c.Nombre {
			t.Errorf("mitad %d: %q", i, got)
		}
	}
	for _, s := range g.Sierras {
		got := LeerAnchoDeSierra(s.Texto)
		if (got == nil) != (s.Mm == nil) || (got != nil && *got != *s.Mm) {
			t.Errorf("sierra %q: %v, TS %v", s.Texto, got, s.Mm)
		}
	}
	for i, c := range g.Calculadoras {
		if !igualJSON(t, fmt.Sprintf("techo %d", i), CalcularTecho(c.Largo, c.Ancho, c.Tipo, c.P), c.Techo) ||
			!igualJSON(t, fmt.Sprintf("placas %d", i), CalcularPlacas(c.Piezas, c.PlacaAncho, c.PlacaLargo, c.P.AnchoSierraMm, c.P.MargenSeguridad), c.Placas) ||
			!igualJSON(t, fmt.Sprintf("piso %d", i), CalcularPiso(c.Largo, c.Ancho, 0, c.P.SeparacionPisoM), c.Piso) {
			break
		}
		tabla := c.P.Deck.Grandis
		if c.Material == "pvc" {
			tabla = c.P.Deck.Pvc
		}
		if !igualJSON(t, fmt.Sprintf("deck %d", i), CalcularDeck(c.Largo, c.Ancho, c.Material, tabla, c.P.MargenSeguridad, c.P.SeparacionPisoM), c.Deck) {
			break
		}
	}
	for _, x := range g.Textos {
		if a, b := TextoPtx(x.Texto, 50), TextoPtx(x.Texto, 25); a != x.Ptx || b != x.Ptx25 {
			t.Errorf("textoPtx %q: %q %q, TS %q %q", x.Texto, a, b, x.Ptx, x.Ptx25)
		}
	}
	for _, x := range g.Nombres {
		if got := NombreDeArchivoPtx(x.Numero); got != x.Nombre {
			t.Errorf("nombre PTX %q: %q, TS %q", x.Numero, got, x.Nombre)
		}
	}
	for _, x := range g.Espesores {
		got, ok := EspesorDelMaterial(x.Material)
		if ok != (x.Espesor != nil) || (ok && got != *x.Espesor) {
			t.Errorf("espesor %q: %v %v", x.Material, got, ok)
		}
	}
}

func ptr[T any](v T) *T { return &v }
