package compras

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
)

// Las cuentas contra el golden del TS real (scripts/golden/compras.ts).

func cargar(t *testing.T, nombre string, v any) {
	t.Helper()
	crudo, err := os.ReadFile("../../testdata/golden/compras/" + nombre)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(crudo, v); err != nil {
		t.Fatal(err)
	}
}

// numJS lee lo que el golden escribió para un número que puede ser NaN o ±∞.
type numJS float64

func (n *numJS) UnmarshalJSON(b []byte) error {
	switch string(b) {
	case `"NaN"`:
		*n = numJS(math.NaN())
	case `"Inf"`:
		*n = numJS(math.Inf(1))
	case `"-Inf"`:
		*n = numJS(math.Inf(-1))
	default:
		var f float64
		if err := json.Unmarshal(b, &f); err != nil {
			return err
		}
		*n = numJS(f)
	}
	return nil
}

func igual(a, b float64) bool {
	return a == b && math.Signbit(a) == math.Signbit(b) || math.IsNaN(a) && math.IsNaN(b)
}

func TestCostoComoTS(t *testing.T) {
	var g struct {
		Costos []struct {
			Actual                      EstadoDeCosto
			Cantidad, CostoUnitario     numJS
			CantidadBase, CostoPromedio float64
		}
		Prorrateos []struct {
			Lineas         []LineaDeCosto
			Gastos         numJS
			CostoConGastos []float64
		}
		Recepciones []struct {
			Inicial map[string]struct{ CantidadBase, CostoPromedio string }
			Pasos   []struct {
				Items  []struct{ VariantID, Cantidad, CostoUnitario, AlicuotaIva string }
				Gastos string
				Lineas []struct {
					CostoConGastos, CantidadAnterior, CostoAnterior, CostoResultante, CantidadNueva string
					Unidades                                                                        float64
				}
				Deuda, Neto string
				NetoNumero  float64
			}
		}
	}
	cargar(t, "costo.json", &g)
	for _, c := range g.Costos {
		r := MezclarCosto(c.Actual, float64(c.Cantidad), float64(c.CostoUnitario))
		if !igual(r.CantidadBase, c.CantidadBase) || !igual(r.CostoPromedio, c.CostoPromedio) {
			t.Errorf("mezclarCosto(%+v, %v, %v) = %+v, TS %v %v", c.Actual, c.Cantidad, c.CostoUnitario, r, c.CantidadBase, c.CostoPromedio)
		}
	}
	for _, c := range g.Prorrateos {
		r := ProrratearGastos(c.Lineas, float64(c.Gastos))
		if !reflect.DeepEqual(r, c.CostoConGastos) && !(len(r) == 0 && len(c.CostoConGastos) == 0) {
			t.Errorf("prorratearGastos(%v, %v) = %v, TS %v", c.Lineas, c.Gastos, r, c.CostoConGastos)
		}
	}
	// Las recepciones encadenadas, con el estado guardado como numeric(14,4).
	for n, c := range g.Recepciones {
		estado := map[string][2]string{}
		for k, v := range c.Inicial {
			estado[k] = [2]string{v.CantidadBase, v.CostoPromedio}
		}
		for p, paso := range c.Pasos {
			lineas := make([]LineaRecibida, len(paso.Items))
			for i, it := range paso.Items {
				lineas[i] = LineaRecibida{it.VariantID, jsmath.Numero(it.Cantidad), jsmath.Numero(it.CostoUnitario), jsmath.Numero(it.AlicuotaIva)}
			}
			k := 0
			neto, deuda, _ := CuentaDeRecepcion(lineas, jsmath.Numero(paso.Gastos),
				func(v string) (EstadoDeCosto, error) {
					e, ok := estado[v]
					if !ok {
						return EstadoDeCosto{}, nil
					}
					return EstadoDeCosto{jsmath.Numero(e[0]), jsmath.Numero(e[1])}, nil
				},
				func(v string, previo, nuevo EstadoDeCosto, l LineaConfirmada) error {
					want := paso.Lineas[k]
					got := []string{jsmath.ToFixed(l.CostoConGastos, 4), jsmath.ToFixed(previo.CantidadBase, 4), jsmath.ToFixed(previo.CostoPromedio, 4),
						jsmath.ToFixed(nuevo.CostoPromedio, 4), jsmath.ToFixed(nuevo.CantidadBase, 4)}
					if !reflect.DeepEqual(got, []string{want.CostoConGastos, want.CantidadAnterior, want.CostoAnterior, want.CostoResultante, want.CantidadNueva}) || l.Unidades != want.Unidades {
						t.Errorf("recepción %d paso %d línea %d: Go %v %v, TS %+v", n, p, k, got, l.Unidades, want)
					}
					estado[v] = [2]string{got[4], got[3]}
					k++
					return nil
				})
			if jsmath.Fijo2(deuda) != paso.Deuda || jsmath.Fijo2(neto) != paso.Neto || neto != paso.NetoNumero {
				t.Errorf("recepción %d paso %d: deuda %s neto %v, TS %s %v", n, p, jsmath.Fijo2(deuda), neto, paso.Deuda, paso.NetoNumero)
			}
		}
	}
}

func TestRetencionesComoTS(t *testing.T) {
	var g struct {
		Retenciones []struct {
			Base, AcumuladoMes, RetenidoMes float64
			Regimen                         Regimen
			Inscripto                       bool
			Imponible, Alicuota, Retencion  float64
			Motivo                          *string
		}
		Meses []struct {
			Regimenes []Regimen
			Inscripto bool
			Pagos     []struct {
				Total   float64
				Pedidas []struct {
					Codigo string
					Base   float64
				}
				Certificados []struct {
					Codigo   string
					Importe  float64
					Alicuota string
				}
				Neto, Retenido            float64
				TotalGuardado, Movimiento string
			}
		}
		Controles []struct {
			Total, Retenido, Neto float64
			Facturas              []struct {
				Numero                   int64
				Total, Imputado, Importe float64
			}
			Partes []float64
			Error  *string
		}
		Cheques []struct {
			T, Normal string
			Problema  *string
		}
	}
	cargar(t, "retenciones.json", &g)
	for _, c := range g.Retenciones {
		r := CalcularRetencion(c.Base, c.AcumuladoMes, c.RetenidoMes, c.Regimen, c.Inscripto)
		want := Retencion{c.Imponible, c.Alicuota, c.Retencion, c.Motivo}
		if !reflect.DeepEqual(r, want) {
			t.Errorf("calcularRetencion(%+v) = %+v, TS %+v", c, r, want)
		}
	}
	// Meses enteros: el acumulado lo suma Postgres sobre lo guardado, exacto.
	for n, mes := range g.Meses {
		acum := map[string][2]int64{}
		for p, pago := range mes.Pagos {
			retenido := 0.0
			var certs []string
			for _, pedida := range pago.Pedidas {
				var reg Regimen
				for _, r := range mes.Regimenes {
					if r.Codigo == pedida.Codigo {
						reg = r
					}
				}
				a := acum[pedida.Codigo]
				r := CalcularRetencion(pedida.Base, centavosAFloat(a[0]), centavosAFloat(a[1]), reg, mes.Inscripto)
				if r.Retencion <= 0 {
					continue
				}
				acum[pedida.Codigo] = [2]int64{a[0] + aCentavos(jsmath.Fijo2(pedida.Base)), a[1] + aCentavos(jsmath.Fijo2(r.Retencion))}
				retenido = jsmath.Redondear2(retenido + r.Retencion)
				certs = append(certs, pedida.Codigo+" "+jsmath.Texto(r.Retencion)+" "+jsmath.ToFixed(r.Alicuota, 3))
			}
			var want []string
			for _, c := range pago.Certificados {
				want = append(want, c.Codigo+" "+jsmath.Texto(c.Importe)+" "+c.Alicuota)
			}
			neto := jsmath.Redondear2(pago.Total - retenido)
			if !reflect.DeepEqual(certs, want) || neto != pago.Neto || retenido != pago.Retenido || jsmath.Fijo2(-pago.Total) != pago.Movimiento {
				t.Errorf("mes %d pago %d: Go %v neto %v, TS %v neto %v", n, p, certs, neto, want, pago.Neto)
			}
		}
	}
	for n, c := range g.Controles {
		var err error
		if c.Neto < 0 {
			err = fallo("Las retenciones superan el importe del pago.")
		}
		var imput []float64
		for _, f := range c.Facturas {
			imput = append(imput, f.Importe)
			if err == nil && f.Importe > 0 {
				err = revisarImputacion(FacturaImputada{f.Numero, f.Total, f.Imputado, f.Importe})
			}
		}
		if err == nil {
			err = revisarSumas(c.Total, c.Neto, imput, c.Partes)
		}
		got := mensajeDe(err)
		if c.Error == nil && err != nil || c.Error != nil && got != *c.Error {
			t.Errorf("control %d: Go %q, TS %v", n, got, c.Error)
		}
	}
	for _, c := range g.Cheques {
		p := RevisarNumeroDeCheque(c.T)
		if NormalizarNumeroDeCheque(c.T) != c.Normal || (c.Problema == nil) != (p == "") || c.Problema != nil && *c.Problema != p {
			t.Errorf("cheque %q: Go %q %q, TS %q %v", c.T, NormalizarNumeroDeCheque(c.T), p, c.Normal, c.Problema)
		}
	}
}

func mensajeDe(err error) string {
	var p *plataforma.Problema
	if errors.As(err, &p) {
		for _, m := range p.Errores {
			return m
		}
		return p.Detalle
	}
	if err != nil {
		return err.Error()
	}
	return ""
}

func aCentavos(t string) int64 {
	neg := strings.HasPrefix(t, "-")
	t = strings.TrimPrefix(t, "-")
	e, d, _ := strings.Cut(t, ".")
	c := int64(jsmath.Numero(e))*100 + int64(jsmath.Numero((d + "00")[:2]))
	if neg {
		return -c
	}
	return c
}

func centavosAFloat(c int64) float64 {
	signo := ""
	if c < 0 {
		signo, c = "-", -c
	}
	return jsmath.Numero(signo + jsmath.Texto(float64(c/100)) + "." + strings.Repeat("0", 2-len(jsmath.Texto(float64(c%100)))) + jsmath.Texto(float64(c%100)))
}

func TestListaDeProveedorComoTS(t *testing.T) {
	var g struct {
		Listas []struct {
			Grilla    [][]string
			Perfil    PerfilDeProveedor
			Filas     []FilaDeProveedor
			Problemas []ProblemaDeFila
		}
	}
	cargar(t, "lista.json", &g)
	for _, c := range g.Listas {
		filas, problemas := LeerListaDeProveedor(c.Grilla, c.Perfil)
		if !reflect.DeepEqual(filas, c.Filas) || !reflect.DeepEqual(problemas, c.Problemas) {
			t.Errorf("leerListaDeProveedor(%q, %+v):\nGo %+v %+v\nTS %+v %+v", c.Grilla, c.Perfil, filas, problemas, c.Filas, c.Problemas)
		}
	}
}

func TestFiscalComoTS(t *testing.T) {
	var g struct {
		Libros []struct {
			Filas []struct {
				FechaEmision                                            time.Time
				Tipo                                                    string
				PuntoVenta, Numero                                      int64
				Proveedor                                               string
				Cuit, Cae                                               *string
				Neto, Iva21, Iva105, Iva27, Exento, Percepciones, Total string
			}
			Totales    TotalesLibro
			Computable float64
			Csv        string
			ConSigno   [][7]float64
		}
		CsvRetenciones []struct {
			Filas []struct {
				Fecha                           time.Time
				Numero, Impuesto, CodigoRegimen string
				Proveedor                       string
				Cuit                            *string
				Base, Alicuota, Importe         string
			}
			Csv string
		}
		Libretas []struct {
			Montos []string
			Saldos []float64
			Saldo  float64
		}
		FacturasConSaldo []struct {
			Total, Imputado    string
			PuntoVenta, Numero int64
			Saldo              float64
			Vale               bool
			Texto              string
		}
		Periodos []struct {
			V            *string
			Anio, Mes    int
			Desde, Hasta time.Time
			Clave        string
		}
		Vencimientos []struct {
			Fecha                string
			Dias                 int
			Emision, Vencimiento time.Time
		}
		Montos []struct {
			V numJS
			T string
		}
	}
	cargar(t, "fiscal.json", &g)
	for n, l := range g.Libros {
		filas := make([]RenglonLibro, len(l.Filas))
		for i, f := range l.Filas {
			filas[i] = ConSigno(RenglonLibro{FechaEmision: f.FechaEmision, Tipo: f.Tipo, PuntoVenta: f.PuntoVenta, Numero: f.Numero, Proveedor: f.Proveedor,
				Cuit: f.Cuit, Cae: f.Cae, Neto: jsmath.Numero(f.Neto), Iva21: jsmath.Numero(f.Iva21), Iva105: jsmath.Numero(f.Iva105),
				Iva27: jsmath.Numero(f.Iva27), Exento: jsmath.Numero(f.Exento), Percepciones: jsmath.Numero(f.Percepciones), Total: jsmath.Numero(f.Total)})
			x := filas[i]
			if [7]float64{x.Neto, x.Iva21, x.Iva105, x.Iva27, x.Exento, x.Percepciones, x.Total} != l.ConSigno[i] {
				t.Errorf("libro %d fila %d: signo", n, i)
			}
		}
		tot := SumarLibro(filas)
		if tot != l.Totales {
			t.Errorf("libro %d: totales %+v, TS %+v", n, tot, l.Totales)
		}
		if csv := CsvLibroIva(filas, tot); csv != l.Csv {
			t.Errorf("libro %d: CSV\nGo %q\nTS %q", n, csv, l.Csv)
		}
	}
	for n, c := range g.CsvRetenciones {
		filas := make([]RetencionDelPeriodo, len(c.Filas))
		for i, f := range c.Filas {
			filas[i] = RetencionDelPeriodo{Numero: f.Numero, Fecha: f.Fecha, Impuesto: f.Impuesto, CodigoRegimen: f.CodigoRegimen, Proveedor: f.Proveedor,
				Cuit: f.Cuit, Base: jsmath.Numero(f.Base), Alicuota: jsmath.Numero(f.Alicuota), Importe: jsmath.Numero(f.Importe)}
		}
		if csv := csvRetenciones(filas, false); csv != c.Csv {
			t.Errorf("retenciones %d: CSV\nGo %q\nTS %q", n, csv, c.Csv)
		}
	}
	for n, l := range g.Libretas {
		montos := make([]float64, len(l.Montos))
		for i, m := range l.Montos {
			montos[i] = jsmath.Numero(m)
		}
		saldos, total := SaldosCorrientes(montos)
		if !reflect.DeepEqual(saldos, l.Saldos) && len(saldos)+len(l.Saldos) > 0 || total != l.Saldo {
			t.Errorf("libreta %d: Go %v %v, TS %v %v", n, saldos, total, l.Saldos, l.Saldo)
		}
	}
	for _, f := range g.FacturasConSaldo {
		s := SaldoDeFactura(jsmath.Numero(f.Total), jsmath.Numero(f.Imputado))
		if s != f.Saldo || (s > 0.009) != f.Vale || NumeroDeCompra(f.PuntoVenta, f.Numero) != f.Texto {
			t.Errorf("factura %+v: Go %v %s", f, s, NumeroDeCompra(f.PuntoVenta, f.Numero))
		}
	}
	ahora := time.Date(2026, 10, 29, 15, 0, 0, 0, time.UTC)
	for _, p := range g.Periodos {
		v := ""
		if p.V != nil {
			v = *p.V
		}
		r := LeerPeriodoMensual(v, ahora)
		if r.Anio != p.Anio || r.Mes != p.Mes || !r.Desde.Equal(p.Desde) || !r.Hasta.Equal(p.Hasta) || r.Clave != p.Clave {
			t.Errorf("periodo %q: Go %+v, TS %+v", v, r, p)
		}
	}
	for _, c := range g.Vencimientos {
		e, ok := LeerFecha(c.Fecha)
		if !ok || !e.Equal(c.Emision) || !Vencimiento(e, c.Dias).Equal(c.Vencimiento) {
			t.Errorf("vencimiento %s + %d: Go %v %v, TS %v", c.Fecha, c.Dias, e, Vencimiento(e, c.Dias), c.Vencimiento)
		}
	}
	for _, m := range g.Montos {
		if m.V == 0 && strings.HasPrefix(m.T, "-") {
			continue // el -0 no sobrevive a JSON.stringify: el golden lo escribe como 0
		}
		if r := Monto(float64(m.V)); r != m.T {
			t.Errorf("formatearMonto(%v) = %q, TS %q", m.V, r, m.T)
		}
	}
}

// sinNulos saca las claves en null (zod deja algunas, otras no: da igual
// para lo que se hace después) y pasa todo por JSON.
func sinNulos(v any) any {
	switch x := v.(type) {
	case map[string]any:
		out := map[string]any{}
		for k, e := range x {
			if l, es := e.([]any); e == nil || es && len(l) == 0 {
				continue // null y [] dan lo mismo para lo que se hace después
			}
			out[k] = sinNulos(e)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = sinNulos(e)
		}
		return out
	case string:
		// Las fechas, en una sola forma.
		if f, err := time.Parse(time.RFC3339Nano, x); err == nil {
			return f.UTC().Format(time.RFC3339Nano)
		}
	}
	return v
}

func comoJSON(v any) any {
	b, _ := json.Marshal(v)
	var out any
	_ = json.Unmarshal(b, &out)
	return sinNulos(out)
}

func TestEsquemasComoZod(t *testing.T) {
	var g map[string][]struct {
		Entrada json.RawMessage
		Datos   any
		Error   *string
		Campo   string
		Ok      *bool
	}
	cargar(t, "esquemas.json", &g)
	deObjeto := func(raw json.RawMessage) map[string]any {
		var m map[string]any
		_ = json.Unmarshal(raw, &m)
		return m
	}
	deForm := func(raw json.RawMessage) map[string]*string {
		var m map[string]*string
		_ = json.Unmarshal(raw, &m)
		return m
	}
	lectores := map[string]func(json.RawMessage) (any, error){
		"ficha":      func(r json.RawMessage) (any, error) { return leerFicha(deObjeto(r)) },
		"movimiento": func(r json.RawMessage) (any, error) { return leerMovimiento(deObjeto(r)) },
		"condicion":  func(r json.RawMessage) (any, error) { return leerCondicion(deForm(r)) },
		"orden":      func(r json.RawMessage) (any, error) { return leerOrden(deObjeto(r)) },
		"recepcion":  func(r json.RawMessage) (any, error) { return leerRecepcion(deObjeto(r)) },
		"factura":    func(r json.RawMessage) (any, error) { return leerFactura(deObjeto(r)) },
		"gasto":      func(r json.RawMessage) (any, error) { return leerGasto(deObjeto(r)) },
		"pago":       func(r json.RawMessage) (any, error) { return leerPago(deObjeto(r)) },
		"perfil":     func(r json.RawMessage) (any, error) { return leerPerfil(deForm(r)) },
	}
	for nombre, leerlo := range lectores {
		casos := g[nombre]
		if len(casos) == 0 {
			t.Fatalf("sin casos de %s", nombre)
		}
		for _, c := range casos {
			datos, err := leerlo(c.Entrada)
			if c.Error != nil {
				var p *plataforma.Problema
				if !errors.As(err, &p) || p.Errores[c.Campo] != *c.Error {
					t.Errorf("%s %s: Go %v, zod %s: %q", nombre, c.Entrada, err, c.Campo, *c.Error)
				}
				continue
			}
			if err != nil {
				t.Errorf("%s %s: Go %v, zod la acepta", nombre, c.Entrada, err)
				continue
			}
			if got, want := comoJSON(datos), sinNulos(c.Datos); !reflect.DeepEqual(got, want) {
				t.Errorf("%s %s:\nGo  %v\nzod %v", nombre, c.Entrada, got, want)
			}
		}
	}
	for _, c := range g["regimen"] {
		r, ok := leerRegimen(deForm(c.Entrada))
		if ok != *c.Ok {
			t.Errorf("régimen %s: Go %v, zod %v", c.Entrada, ok, *c.Ok)
			continue
		}
		if ok {
			d := c.Datos.(map[string]any)
			if jsmath.ToFixed(r.Alicuota, 3) != d["alicuota"] || jsmath.ToFixed(r.AlicuotaNoInscripto, 3) != d["alicuotaNoInscripto"] ||
				r.Activo != d["activo"] || jsmath.Texto(r.Alicuota) != d["texto"] {
				t.Errorf("régimen %s: Go %+v, zod %v", c.Entrada, r, d)
			}
		}
	}
	for _, c := range g["aplicar"] {
		var v any
		_ = json.Unmarshal(c.Entrada, &v)
		if _, ok := leerFilasAplicar(v); ok != *c.Ok {
			t.Errorf("aplicar %s: Go %v, zod %v", c.Entrada, ok, *c.Ok)
		}
	}
}
