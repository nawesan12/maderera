package reportes

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
	"time"

	"mjbj/internal/caja"
)

// Los golden de scripts/golden/reportes.ts: el TS real (o su copia textual)
// sobre los casos de vitest y miles al azar. Go tiene que dar lo mismo.

func leer(t *testing.T, nombre string, v any) {
	t.Helper()
	b, err := os.ReadFile("../../testdata/golden/reportes/" + nombre)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

func igual(a, b *float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b || (math.IsNaN(*a) && math.IsNaN(*b))
}

func TestGoldenReposicionPura(t *testing.T) {
	var casos []struct {
		Disponible, Vendido, Dias, Objetivo, VentaDiaria, Sugerido float64
		Cobertura                                                  *float64
	}
	leer(t, "reposicion-pura.json", &casos)
	for i, c := range casos {
		if v := VentaDiaria(c.Vendido, c.Dias); v != c.VentaDiaria {
			t.Fatalf("%d ventaDiaria: %v, TS %v", i, v, c.VentaDiaria)
		}
		if v := DiasDeCobertura(c.Disponible, c.Vendido, c.Dias); !igual(v, c.Cobertura) {
			t.Fatalf("%d cobertura: %v, TS %v", i, v, c.Cobertura)
		}
		if v := SugerenciaDeCompra(c.Disponible, c.Vendido, c.Dias, c.Objetivo); v != c.Sugerido {
			t.Fatalf("%d sugerido %+v: %v, TS %v", i, c, v, c.Sugerido)
		}
	}
	t.Logf("%d casos", len(casos))
}

func TestGoldenArmarReposicion(t *testing.T) {
	var casos []struct {
		Stock    []StockDeVariante
		Vendido  map[string]float64
		Opciones struct {
			DiasDelPeriodo, CoberturaObjetivo float64
			Sucursal                          string
		}
		Reporte ReporteDeReposicion
		Csv     string
	}
	leer(t, "reposiciones.json", &casos)
	for i, c := range casos {
		r := ArmarReposicion(c.Stock, c.Vendido, c.Opciones.DiasDelPeriodo, c.Opciones.CoberturaObjetivo, c.Opciones.Sucursal)
		if c.Reporte.Filas == nil {
			c.Reporte.Filas = []FilaDeReposicion{}
		}
		if c.Reporte.PorCategoria == nil {
			c.Reporte.PorCategoria = []VendidoPorCategoria{}
		}
		if !reflect.DeepEqual(r, c.Reporte) {
			g, _ := json.Marshal(r)
			w, _ := json.Marshal(c.Reporte)
			t.Fatalf("%d:\n go %s\n ts %s", i, g, w)
		}
		if csv := CsvReposicion(r); csv != c.Csv {
			t.Fatalf("%d csv:\n go %q\n ts %q", i, csv, c.Csv)
		}
	}
	t.Logf("%d casos", len(casos))
}

type entradaAsiento struct {
	Tipo                                                           string
	Fecha                                                          time.Time
	Comprobante, Cliente, Proveedor, Descripcion, Categoria, Medio string
	Referencia                                                     *string
	Neto, Iva, Tributos, Total, Importe, Percepciones, Retenido    float64
	EsNotaDeCredito, DaCreditoFiscal                               bool
}

func asientoDe(e entradaAsiento) Asiento {
	switch e.Tipo {
	case "venta":
		return AsientoDeVenta(VentaAAsentar{e.Fecha, e.Comprobante, e.Cliente, e.Neto, e.Iva, e.Tributos, e.Total, e.EsNotaDeCredito, 0})
	case "cobro":
		return AsientoDeCobro(CobroAAsentar{e.Fecha, e.Comprobante, e.Cliente, e.Medio, e.Importe})
	case "compra":
		return AsientoDeCompra(CompraAAsentar{e.Fecha, e.Comprobante, e.Proveedor, e.Neto, e.Iva, e.Percepciones, e.Total, e.DaCreditoFiscal, e.EsNotaDeCredito, 0})
	case "pago":
		return AsientoDePagoAProveedor(PagoAAsentar{e.Fecha, e.Proveedor, e.Medio, e.Referencia, e.Total, e.Retenido})
	}
	return AsientoDeGasto(GastoAAsentar{e.Fecha, e.Descripcion, e.Categoria, e.Medio, e.Importe})
}

func TestGoldenAsientos(t *testing.T) {
	var casos []struct {
		Entrada         entradaAsiento
		Asiento         Asiento
		Balancea        bool
		Nombre          string
		TipoComprobante string
	}
	leer(t, "asientos.json", &casos)
	for i, c := range casos {
		a := asientoDe(c.Entrada)
		c.Asiento.Balancea = c.Balancea
		if !reflect.DeepEqual(a, c.Asiento) {
			g, _ := json.Marshal(a)
			w, _ := json.Marshal(c.Asiento)
			t.Fatalf("%d:\n go %s\n ts %s", i, g, w)
		}
		if n := NombreComprobante(c.TipoComprobante); n != c.Nombre {
			t.Fatalf("%d nombre: %q, TS %q", i, n, c.Nombre)
		}
	}
	var csvs []struct {
		Asientos []Asiento
		Csv      string
	}
	leer(t, "csv-asientos.json", &csvs)
	for i, c := range csvs {
		for _, a := range c.Asientos {
			if Balancea(a.Renglones) != a.Balancea {
				t.Fatalf("%d balancea: %+v", i, a)
			}
		}
		if csv := CsvAsientos(c.Asientos); csv != c.Csv {
			t.Fatalf("%d csv:\n go %q\n ts %q", i, csv, c.Csv)
		}
	}
	t.Logf("%d asientos, %d CSV", len(casos), len(csvs))
}

func TestGoldenReporteDeVentas(t *testing.T) {
	var casos []struct {
		Corte, Leido string
		Filas        []FilaDeReporte
		Csv          string
	}
	leer(t, "reportes.json", &casos)
	for i, c := range casos {
		if l := LeerCorte(c.Corte); l != c.Leido {
			t.Fatalf("%d corte %q: %q, TS %q", i, c.Corte, l, c.Leido)
		}
		if csv := CsvReporteDeVentas(c.Leido, c.Filas); csv != c.Csv {
			t.Fatalf("%d csv:\n go %q\n ts %q", i, csv, c.Csv)
		}
	}
	var v struct {
		Cortes   []struct{ Valor, Corte string }
		Plurales []struct {
			N     float64
			Texto string
		}
		Rubros       []struct{ Valor, Etiqueta string }
		Comprobantes []struct{ Tipo, Nombre, Numero string }
	}
	leer(t, "varios.json", &v)
	for _, c := range v.Cortes {
		if LeerCorte(c.Valor) != c.Corte {
			t.Errorf("corte %q", c.Valor)
		}
	}
	for _, p := range v.Plurales {
		if Plural(p.N, "producto", "") != p.Texto {
			t.Errorf("plural %v: %q", p.N, Plural(p.N, "producto", ""))
		}
	}
	for _, r := range v.Rubros {
		if EtiquetaDeRubro(r.Valor) != r.Etiqueta {
			t.Errorf("rubro %q: %q", r.Valor, EtiquetaDeRubro(r.Valor))
		}
	}
	for _, c := range v.Comprobantes {
		if NombreComprobante(c.Tipo) != c.Nombre || NumeroFormateado(3, 127) != c.Numero {
			t.Errorf("comprobante %q", c.Tipo)
		}
	}
}

func fechaISO(p *time.Time) *string {
	if p == nil {
		return nil
	}
	s := p.UTC().Format("2006-01-02T15:04:05.000Z")
	return &s
}

func igualTexto(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func TestGoldenPeriodos(t *testing.T) {
	var casos []struct {
		Ahora                                      time.Time
		Clave, Etiqueta                            string
		Desde, Hasta, AnteriorDesde, AnteriorHasta *string
	}
	leer(t, "periodos.json", &casos)
	for i, c := range casos {
		p := ResolverPeriodo(c.Clave, c.Ahora)
		if p.Etiqueta != c.Etiqueta || !igualTexto(fechaISO(p.Desde), c.Desde) || !igualTexto(fechaISO(p.Hasta), c.Hasta) ||
			!igualTexto(fechaISO(p.AnteriorDesde), c.AnteriorDesde) || !igualTexto(fechaISO(p.AnteriorHasta), c.AnteriorHasta) {
			t.Fatalf("%d %s %v: %+v / %v %v %v %v", i, c.Clave, c.Ahora, c, fechaISO(p.Desde), fechaISO(p.Hasta), fechaISO(p.AnteriorDesde), fechaISO(p.AnteriorHasta))
		}
	}
	for _, archivo := range []struct {
		nombre string
		zona   *time.Location
	}{{"mensuales-art.json", Argentina}, {"mensuales-utc.json", time.UTC}} {
		var ms []struct {
			Valor        string
			Ahora        time.Time
			Anio, Mes    int
			Desde, Hasta time.Time
			Clave        string
		}
		leer(t, archivo.nombre, &ms)
		for i, m := range ms {
			p := LeerPeriodoMensual(m.Valor, m.Ahora, archivo.zona)
			if p.Anio != m.Anio || p.Mes != m.Mes || !p.Desde.Equal(m.Desde) || !p.Hasta.Equal(m.Hasta) || p.Clave != m.Clave {
				t.Fatalf("%s %d %q: %+v, TS %+v", archivo.nombre, i, m.Valor, p, m)
			}
		}
	}
}

func TestGoldenSeries(t *testing.T) {
	var casos []struct {
		Ahora        time.Time
		Clave        string
		Meses        int
		Desde, Hasta *time.Time
		PorMes       map[string]float64
		Serie        []MesDelReporte
	}
	leer(t, "series.json", &casos)
	corregidos := 0
	for i, c := range casos {
		s := SerieDeMeses(c.Desde, c.Hasta, c.Ahora, c.Meses, c.PorMes)
		esperado := c.Serie
		// El arreglo: con un hasta (exclusivo) el mes que empieza ahí no va.
		if c.Hasta != nil && len(esperado) > 0 && esperado[len(esperado)-1].Clave == c.Hasta.In(Argentina).Format("2006-01") {
			esperado = esperado[:len(esperado)-1]
			corregidos++
		}
		if !reflect.DeepEqual(s, esperado) {
			t.Fatalf("%d %s %v:\n go %+v\n ts %+v", i, c.Clave, c.Ahora, s, c.Serie)
		}
	}
	if corregidos == 0 {
		t.Error("ningún caso del mes en curso de más")
	}
	t.Logf("%d series, %d con el mes de más del TS", len(casos), corregidos)

	var resumen []struct {
		Ahora time.Time
		Meses []struct {
			Clave, Mes string
			Desde      time.Time
		}
	}
	leer(t, "meses-resumen.json", &resumen)
	for i, r := range resumen {
		for k, m := range r.Meses {
			d := InicioDeMes(r.Ahora, 5-k)
			if !d.Equal(m.Desde) || claveDeMes(d) != m.Clave || mesesDelResumen[d.Month()-1] != m.Mes {
				t.Fatalf("%d/%d: %v, TS %+v", i, k, d, m)
			}
		}
	}
	var variaciones []struct {
		Actual, Previo float64
		Variacion      *float64
	}
	leer(t, "variaciones.json", &variaciones)
	for i, v := range variaciones {
		if g := Variacion(v.Actual, v.Previo); !igual(g, v.Variacion) {
			t.Fatalf("%d: %v, TS %v", i, g, v.Variacion)
		}
	}
}

// La caja usa su propia copia del mes argentino (caja no puede importar
// reportes): tiene que dar lo mismo que el TS en hora argentina.
func TestGoldenMesDeLaCaja(t *testing.T) {
	var ms []struct {
		Valor        string
		Ahora        time.Time
		Desde, Hasta time.Time
	}
	leer(t, "mensuales-art.json", &ms)
	for i, m := range ms {
		d, h := caja.MesArgentino(m.Valor, m.Ahora)
		if !d.Equal(m.Desde) || !h.Equal(m.Hasta) {
			t.Fatalf("%d %q: %v %v, TS %v %v", i, m.Valor, d, h, m.Desde, m.Hasta)
		}
	}
}

func TestGoldenCaja(t *testing.T) {
	var turnos []struct {
		AbiertaAt        time.Time
		Estado, Etiqueta string
	}
	leer(t, "turnos.json", &turnos)
	for i, x := range turnos {
		if e := caja.EtiquetaDeTurno(x.AbiertaAt, x.Estado); e != x.Etiqueta {
			t.Fatalf("%d: %q, TS %q", i, e, x.Etiqueta)
		}
	}
	var altas []struct {
		Cuerpo map[string]any
		Ok     bool
		Datos  struct {
			Codigo, BranchID string
			Nombre           *string
		}
		Campo, Mensaje string
	}
	leer(t, "altas.json", &altas)
	for i, a := range altas {
		r, err := caja.LeerAltaDeCaja(a.Cuerpo)
		if a.Ok {
			if err != nil || r.Codigo != a.Datos.Codigo || r.BranchID != a.Datos.BranchID || !igualTexto(r.Nombre, a.Datos.Nombre) {
				t.Fatalf("%d %v: %+v %v, TS %+v", i, a.Cuerpo, r, err, a.Datos)
			}
			continue
		}
		b, _ := json.Marshal(err)
		var p struct{ Errores map[string]string }
		_ = json.Unmarshal(b, &p)
		if p.Errores[a.Campo] != a.Mensaje || len(p.Errores) != 1 {
			t.Fatalf("%d %v: %s, TS %s %q", i, a.Cuerpo, b, a.Campo, a.Mensaje)
		}
	}
	var fondos []struct {
		BranchID string
		Monto    any
		Ok       bool
		Valor    *float64
	}
	leer(t, "fondos.json", &fondos)
	for i, f := range fondos {
		n, ok := caja.LeerFondoBase(f.BranchID, f.Monto)
		if ok != f.Ok || (ok && n != *f.Valor) {
			t.Fatalf("%d %+v: %v %v", i, f, n, ok)
		}
	}
}
