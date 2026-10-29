package facturacion

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"mjbj/internal/plataforma"
)

// Golden de scripts/golden/fiscal.ts: los esquemas de zod de las acciones
// (primer error y su campo, o los datos) y el libro IVA ventas con su CSV.

func cargar(t *testing.T, nombre string, v any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "golden", "fiscal", nombre+".json"))
	if err != nil {
		t.Fatalf("falta el golden (TZ=America/Argentina/Buenos_Aires npx tsx scripts/golden/fiscal.ts): %v", err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

func primerError(err error) (campo, msj string) {
	var p *plataforma.Problema
	if errors.As(err, &p) {
		for k, v := range p.Errores {
			return k, v
		}
	}
	return "", ""
}

func TestGoldenZod(t *testing.T) {
	var casos []struct {
		Esquema string
		Campos  map[string]string
		R       struct {
			Error *string
			Campo string
			Datos map[string]any
		}
	}
	cargar(t, "zod", &casos)
	por := map[string]int{}
	for i, c := range casos {
		var err error
		switch c.Esquema {
		case "manual":
			var d cabecera
			d, err = validarCabecera(c.Campos)
			if err == nil && (d.nombre != c.R.Datos["receptorNombre"] || d.condicion != c.R.Datos["receptorCondicionIva"]) {
				t.Fatalf("%d: datos %+v, TS %v", i, d, c.R.Datos)
			}
		case "linea":
			desc, cant, precio, alic, ok := validarLinea(texto(c.Campos["descripcion"]), texto(c.Campos["cantidad"]), texto(c.Campos["precio"]), texto(c.Campos["alicuota"]))
			if ok != (c.R.Error == nil) {
				t.Fatalf("%d: línea %v %+v, TS %+v", i, ok, c.Campos, c.R)
			}
			if ok && (desc != c.R.Datos["descripcion"] || cant != c.R.Datos["cantidad"] || precio != c.R.Datos["precio"] || alic != c.R.Datos["alicuota"]) {
				t.Fatalf("%d: línea %q %v %v %v, TS %v", i, desc, cant, precio, alic, c.R.Datos)
			}
			por[c.Esquema]++
			continue
		case "emisor":
			var d datosEmisor
			d, err = validarEmisor(c.Campos)
			if err == nil && (d.razon != c.R.Datos["razonSocial"] || d.regimen != c.R.Datos["regimenIibb"]) {
				t.Fatalf("%d: emisor %+v, TS %v", i, d, c.R.Datos)
			}
		case "punto":
			var d datosPunto
			d, err = validarPunto(c.Campos)
			if err == nil && (d.numero != c.R.Datos["numero"] || d.inicial != c.R.Datos["numeroInicial"] || d.activo != c.R.Datos["activo"]) {
				t.Fatalf("%d: punto %+v, TS %v", i, d, c.R.Datos)
			}
		case "anular":
			_, err = validarAnulacion(c.Campos)
		}
		campo, msj := primerError(err)
		esperado := ""
		if c.R.Error != nil {
			esperado = *c.R.Error
		}
		if msj != esperado || (esperado != "" && campo != c.R.Campo) {
			t.Fatalf("%d (%s): %s %q, TS %s %q\n%v", i, c.Esquema, campo, msj, c.R.Campo, esperado, c.Campos)
		}
		por[c.Esquema]++
	}
	t.Logf("%v", por)
}

func TestGoldenLibro(t *testing.T) {
	var casos []struct {
		Filas []struct {
			ID, Tipo, ReceptorNombre                                string
			FechaEmision                                            time.Time
			PuntoVenta, Numero                                      int64
			ReceptorCuit, Cae                                       *string
			Neto, Iva21, Iva105, Iva27, Exento, Tributos, Total string
		}
		ConSigno []map[string]any
		Totales  TotalesLibro
		Csv      string
	}
	cargar(t, "libro", &casos)
	f := func(s string) float64 { var x float64; _ = json.Unmarshal([]byte(s), &x); return x }
	for i, c := range casos {
		var filas []RenglonLibro
		for _, x := range c.Filas {
			filas = append(filas, ConSigno(RenglonLibro{ID: x.ID, FechaEmision: x.FechaEmision, Tipo: x.Tipo, PuntoVenta: x.PuntoVenta, Numero: x.Numero,
				ReceptorNombre: x.ReceptorNombre, ReceptorCuit: x.ReceptorCuit, Neto: f(x.Neto), Iva21: f(x.Iva21), Iva105: f(x.Iva105),
				Iva27: f(x.Iva27), Exento: f(x.Exento), Tributos: f(x.Tributos), Total: f(x.Total), Cae: x.Cae}))
		}
		for k, r := range filas {
			if r.Neto != c.ConSigno[k]["neto"] || r.Total != c.ConSigno[k]["total"] {
				t.Fatalf("%d/%d: con signo %v %v, TS %v", i, k, r.Neto, r.Total, c.ConSigno[k])
			}
		}
		tot := Sumar(filas)
		if tot != c.Totales && !(math.IsNaN(tot.Total)) {
			t.Fatalf("%d: totales %+v, TS %+v", i, tot, c.Totales)
		}
		if g := CsvLibroIva(Libro{Filas: filas, Totales: tot}); g != c.Csv {
			t.Fatalf("%d: el CSV no es el mismo:\n%q\n%q", i, g, c.Csv)
		}
	}
	t.Logf("%d libros", len(casos))
}
