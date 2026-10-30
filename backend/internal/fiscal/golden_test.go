package fiscal

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// Golden de scripts/golden/fiscal.ts (el TS real con
// TZ=America/Argentina/Buenos_Aires). Go tiene que dar lo mismo exacto.

// num es un número del golden: "NaN", "Inf" y "-Inf" vienen como texto.
type num float64

func (n *num) UnmarshalJSON(b []byte) error {
	switch string(b) {
	case `"NaN"`:
		*n = num(math.NaN())
	case `"Inf"`:
		*n = num(math.Inf(1))
	case `"-Inf"`:
		*n = num(math.Inf(-1))
	case "null":
		*n = num(math.NaN())
	default:
		var f float64
		if err := json.Unmarshal(b, &f); err != nil {
			return err
		}
		*n = num(f)
	}
	return nil
}

func igual(a, b float64) bool {
	if math.IsNaN(a) || math.IsNaN(b) {
		return math.IsNaN(a) && math.IsNaN(b)
	}
	return a == b && math.Signbit(a) == math.Signbit(b) || a == b && a != 0
}

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

func TestGoldenDesagregar(t *testing.T) {
	var casos []struct {
		Precio, Alicuota num
		R                struct{ Neto, Iva, Total, Alicuota num }
		Agregado         num
		Redondeo         num
	}
	cargar(t, "desagregar", &casos)
	for i, c := range casos {
		r := Desagregar(float64(c.Precio), float64(c.Alicuota))
		if !igual(r.Neto, float64(c.R.Neto)) || !igual(r.Iva, float64(c.R.Iva)) || !igual(r.Total, float64(c.R.Total)) ||
			!igual(r.Alicuota, float64(c.R.Alicuota)) {
			t.Fatalf("%d: desagregar(%v, %v) = %+v, TS %+v", i, c.Precio, c.Alicuota, r, c.R)
		}
		if a := AgregarIva(float64(c.Precio), float64(c.Alicuota)); !igual(a, float64(c.Agregado)) {
			t.Fatalf("%d: agregarIva = %v, TS %v", i, a, c.Agregado)
		}
		if r := Redondear(float64(float64(c.Precio) * 1.005)); !igual(r, float64(c.Redondeo)) {
			t.Fatalf("%d: redondear = %v, TS %v", i, r, c.Redondeo)
		}
	}
	t.Logf("%d casos", len(casos))
}

type lineaG struct {
	Descripcion         string  `json:"descripcion"`
	Unidad              *string `json:"unidad"`
	Cantidad            num     `json:"cantidad"`
	PrecioFinalUnitario num     `json:"precioFinalUnitario"`
	Alicuota            *num    `json:"alicuota"`
}

func entradas(ls []lineaG) []LineaEntrada {
	out := make([]LineaEntrada, len(ls))
	for i, l := range ls {
		out[i] = LineaEntrada{Descripcion: l.Descripcion, Unidad: l.Unidad, Cantidad: float64(l.Cantidad), PrecioFinalUnitario: float64(l.PrecioFinalUnitario)}
		if l.Alicuota != nil {
			a := float64(*l.Alicuota)
			out[i].Alicuota = &a
		}
	}
	return out
}

type totalesG struct {
	Lineas []struct {
		Descripcion, Unidad                                                              string
		Cantidad, PrecioFinalUnitario, Alicuota, PrecioUnitarioNeto, Neto, Iva, Subtotal num
	}
	Neto               num
	IvaPorAlicuota     []struct{ Alicuota, Base, Importe num }
	Iva, Exento, Total num
}

func compararTotales(t *testing.T, i int, g Totales, e totalesG) {
	t.Helper()
	if len(g.Lineas) != len(e.Lineas) || len(g.IvaPorAlicuota) != len(e.IvaPorAlicuota) {
		t.Fatalf("%d: largos distintos: %+v vs %+v", i, g, e)
	}
	for k, l := range g.Lineas {
		x := e.Lineas[k]
		if l.Descripcion != x.Descripcion || l.Unidad != x.Unidad || !igual(l.Cantidad, float64(x.Cantidad)) ||
			!igual(l.Alicuota, float64(x.Alicuota)) || !igual(l.PrecioUnitarioNeto, float64(x.PrecioUnitarioNeto)) ||
			!igual(l.Neto, float64(x.Neto)) || !igual(l.Iva, float64(x.Iva)) || !igual(l.Subtotal, float64(x.Subtotal)) {
			t.Fatalf("%d, renglón %d: %+v, TS %+v", i, k, l, x)
		}
	}
	for k, a := range g.IvaPorAlicuota {
		x := e.IvaPorAlicuota[k]
		if !igual(a.Alicuota, float64(x.Alicuota)) || !igual(a.Base, float64(x.Base)) || !igual(a.Importe, float64(x.Importe)) {
			t.Fatalf("%d, alícuota %d: %+v, TS %+v", i, k, a, x)
		}
	}
	if !igual(g.Neto, float64(e.Neto)) || !igual(g.Iva, float64(e.Iva)) || !igual(g.Exento, float64(e.Exento)) || !igual(g.Total, float64(e.Total)) {
		t.Fatalf("%d: totales %v %v %v %v, TS %v %v %v %v", i, g.Neto, g.Iva, g.Exento, g.Total, e.Neto, e.Iva, e.Exento, e.Total)
	}
}

func TestGoldenTotales(t *testing.T) {
	var casos []struct {
		Lineas []lineaG
		R      totalesG
	}
	cargar(t, "totales", &casos)
	for i, c := range casos {
		compararTotales(t, i, CalcularTotales(entradas(c.Lineas)), c.R)
	}
	t.Logf("%d casos", len(casos))
}

type tributoG struct {
	Codigo, Descripcion     string
	Base, Alicuota, Importe num
}

func tributos(ts []tributoG) []Tributo {
	if ts == nil {
		return nil
	}
	out := make([]Tributo, len(ts))
	for i, x := range ts {
		out[i] = Tributo{x.Codigo, x.Descripcion, float64(x.Base), float64(x.Alicuota), float64(x.Importe)}
	}
	return out
}

func compararTributos(t *testing.T, i int, g []Tributo, e []tributoG) {
	t.Helper()
	if len(g) != len(e) {
		t.Fatalf("%d: tributos %+v, TS %+v", i, g, e)
	}
	for k, x := range g {
		y := e[k]
		if x.Codigo != y.Codigo || x.Descripcion != y.Descripcion || !igual(x.Base, float64(y.Base)) ||
			!igual(x.Alicuota, float64(y.Alicuota)) || !igual(x.Importe, float64(y.Importe)) {
			t.Fatalf("%d: tributo %d %+v, TS %+v", i, k, x, y)
		}
	}
}

func TestGoldenEmisiones(t *testing.T) {
	var casos []struct {
		Lineas []lineaG
		Dados  []tributoG
		Config struct {
			PercibeIibb            bool
			AlicuotaPercepcionIibb string
		}
		R struct {
			Totales                                    totalesG
			Tributos                                   []tributoG
			TotalTributos, Total, Iva21, Iva105, Iva27 num
		}
	}
	cargar(t, "emisiones", &casos)
	for i, c := range casos {
		alic := 0.0
		_ = json.Unmarshal([]byte(c.Config.AlicuotaPercepcionIibb), &alic)
		e := Importes(entradas(c.Lineas), tributos(c.Dados), c.Config.PercibeIibb, alic)
		compararTotales(t, i, e.Totales, c.R.Totales)
		compararTributos(t, i, e.Tributos, c.R.Tributos)
		if !igual(e.TotalTributos, float64(c.R.TotalTributos)) || !igual(e.Total, float64(c.R.Total)) || !igual(e.Iva21, float64(c.R.Iva21)) ||
			!igual(e.Iva105, float64(c.R.Iva105)) || !igual(e.Iva27, float64(c.R.Iva27)) {
			t.Fatalf("%d: %+v, TS %+v", i, e, c.R)
		}
	}
	t.Logf("%d casos", len(casos))
}

func TestGoldenNotas(t *testing.T) {
	var casos []struct {
		Original map[string]string
		Items    []struct {
			ID, Descripcion, Unidad         string
			Cantidad, Subtotal, AlicuotaIva num
		}
		Parciales []struct {
			ItemID   string
			Cantidad num
		}
		Tributos []tributoG
		R        struct {
			Error, Problema string
			Lineas          []struct {
				Descripcion, Unidad, ItemOrigenID       string
				Cantidad, PrecioFinalUnitario, Alicuota num
			}
			NetoDeLaNota, Proporcion, TotalDeLaNota num
			TributosDados                           []tributoG
		}
	}
	cargar(t, "notas", &casos)
	f := func(s string) float64 { var x float64; _ = json.Unmarshal([]byte(s), &x); return x }
	for i, c := range casos {
		items := make([]ItemOriginal, len(c.Items))
		for k, x := range c.Items {
			items[k] = ItemOriginal{ID: x.ID, Descripcion: x.Descripcion, Unidad: x.Unidad, Cantidad: float64(x.Cantidad),
				Subtotal: float64(x.Subtotal), AlicuotaIva: float64(x.AlicuotaIva)}
		}
		var parciales []CantidadAAcreditar
		if c.Parciales != nil {
			parciales = make([]CantidadAAcreditar, len(c.Parciales))
			for k, p := range c.Parciales {
				parciales[k] = CantidadAAcreditar{p.ItemID, float64(p.Cantidad)}
			}
		}
		o := Original{Neto: f(c.Original["neto"]), Iva21: f(c.Original["iva21"]), Iva105: f(c.Original["iva105"]), Iva27: f(c.Original["iva27"]),
			Exento: f(c.Original["exento"]), Total: f(c.Original["total"]), Acreditado: f(c.Original["acreditado"])}
		g := CalcularNota(o, items, parciales, tributos(c.Tributos))
		if c.R.Error != "" {
			if g.Problema != c.R.Error || g.Lineas != nil {
				t.Fatalf("%d: error %q, TS %q", i, g.Problema, c.R.Error)
			}
			continue
		}
		if g.Problema != c.R.Problema {
			t.Fatalf("%d: problema %q, TS %q", i, g.Problema, c.R.Problema)
		}
		if len(g.Lineas) != len(c.R.Lineas) {
			t.Fatalf("%d: renglones %d, TS %d", i, len(g.Lineas), len(c.R.Lineas))
		}
		for k, l := range g.Lineas {
			x := c.R.Lineas[k]
			if l.Descripcion != x.Descripcion || l.ItemOrigenID != x.ItemOrigenID || !igual(l.Cantidad, float64(x.Cantidad)) ||
				!igual(l.PrecioFinalUnitario, float64(x.PrecioFinalUnitario)) || !igual(l.Alicuota, float64(x.Alicuota)) {
				t.Fatalf("%d: renglón %d %+v, TS %+v", i, k, l, x)
			}
		}
		if !igual(g.Neto, float64(c.R.NetoDeLaNota)) || !igual(g.Proporcion, float64(c.R.Proporcion)) || !igual(g.Total, float64(c.R.TotalDeLaNota)) {
			t.Fatalf("%d: %v %v %v, TS %v %v %v", i, g.Neto, g.Proporcion, g.Total, c.R.NetoDeLaNota, c.R.Proporcion, c.R.TotalDeLaNota)
		}
		compararTributos(t, i, g.TributosDados, c.R.TributosDados)
	}
	t.Logf("%d casos", len(casos))

	var sueltas []struct {
		Total, Acreditado, Monto num
		Revisar                  *string
		Tributos                 []tributoG
		Proporcion               num
		Prorrateo                []tributoG
	}
	cargar(t, "notas-sueltas", &sueltas)
	for i, c := range sueltas {
		r := RevisarAcreditacion(float64(c.Total), float64(c.Acreditado), float64(c.Monto))
		esperado := ""
		if c.Revisar != nil {
			esperado = *c.Revisar
		}
		if r != esperado {
			t.Fatalf("%d: revisar %q, TS %q", i, r, esperado)
		}
		compararTributos(t, i, ProrratearTributos(tributos(c.Tributos), float64(c.Proporcion)), c.Prorrateo)
	}
	var debitos []struct {
		Lineas []lineaG
		R      num
	}
	cargar(t, "debitos", &debitos)
	for i, c := range debitos {
		if g := TotalDeLineas(entradas(c.Lineas)); !igual(g, float64(c.R)) {
			t.Fatalf("%d: débito %v, TS %v", i, g, c.R)
		}
	}
}

func TestGoldenComprobantes(t *testing.T) {
	var g struct {
		Comprobantes []struct{ Emisor, Receptor, Letra, Tipo, Nc, Nd string }
		Documentos   []struct {
			Cuit *string
			R    struct {
				Tipo   int
				Numero num
			}
		}
		Numeros []struct {
			Pv, N                    int64
			Tipo, Formateado, Nombre string
			Codigo                   int
		}
		Fechas []struct {
			T, Arca, Crudo string
			Desde          *string
		}
		Claves []struct {
			Pv    int64
			Tipo  string
			Clave int64
		}
	}
	cargar(t, "comprobantes", &g)
	for _, c := range g.Comprobantes {
		l := LetraQueCorresponde(c.Emisor, c.Receptor)
		if l != c.Letra || TipoFactura(l) != c.Tipo || NotaDeCredito(c.Tipo) != c.Nc || NotaDeDebito(c.Tipo) != c.Nd {
			t.Fatalf("%+v", c)
		}
	}
	for _, c := range g.Documentos {
		tipo, n := DocumentoReceptor(c.Cuit)
		if tipo != c.R.Tipo || !igual(n, float64(c.R.Numero)) {
			t.Fatalf("documento %v: %d %v, TS %+v", c.Cuit, tipo, n, c.R)
		}
	}
	for _, c := range g.Numeros {
		if NumeroFormateado(c.Pv, c.N) != c.Formateado || NombreComprobante(c.Tipo) != c.Nombre || CodigoComprobante[c.Tipo] != c.Codigo {
			t.Fatalf("%+v", c)
		}
	}
	for _, c := range g.Fechas {
		ti, _ := time.Parse(time.RFC3339Nano, c.T)
		if FechaArca(ti) != c.Arca {
			t.Fatalf("fechaArca(%s) = %s, TS %s", c.T, FechaArca(ti), c.Arca)
		}
		d := DesdeFechaArca(c.Crudo)
		if (d == nil) != (c.Desde == nil) || d != nil && d.UTC().Format("2006-01-02T15:04:05.000Z") != *c.Desde {
			t.Fatalf("desdeFechaArca(%q) = %v, TS %v", c.Crudo, d, c.Desde)
		}
	}
	for _, c := range g.Claves {
		if k := ClaveDeLock(c.Pv, c.Tipo); k != c.Clave {
			t.Fatalf("claveDeLock(%d, %q) = %d, TS %d", c.Pv, c.Tipo, k, c.Clave)
		}
	}
}

func TestGoldenPedidosDeCae(t *testing.T) {
	var casos []struct {
		Comprobante *struct {
			Tipo                 string
			PuntoVenta, Numero   int64
			FechaEmision         time.Time
			ReceptorCuit         *string
			ReceptorCondicionIva string
			Neto, Exento, Total  num
			Iva                  []struct{ Alicuota, Base, Importe num }
			Tributos             []tributoG
			Asociado             *struct {
				Tipo               string
				PuntoVenta, Numero int64
				Fecha              time.Time
			}
		}
		Ticket struct{ Token, Sign string }
		Cuit   string
		Sobre  string
		Ultimo string
		Dummy  string
	}
	cargar(t, "pedidos", &casos)
	for i, c := range casos {
		if c.Comprobante == nil {
			if SobreWsfe("FEDummy", "") != c.Dummy {
				t.Fatal("el sobre de FEDummy no da igual")
			}
			continue
		}
		x := c.Comprobante
		a := AAutorizar{Tipo: x.Tipo, PuntoVenta: x.PuntoVenta, Numero: x.Numero, FechaEmision: x.FechaEmision, ReceptorCuit: x.ReceptorCuit,
			ReceptorCondicionIva: x.ReceptorCondicionIva, Neto: float64(x.Neto), Exento: float64(x.Exento), Total: float64(x.Total),
			Tributos: tributos(x.Tributos)}
		if a.Tributos == nil {
			a.Tributos = []Tributo{}
		}
		for _, v := range x.Iva {
			a.Iva = append(a.Iva, IvaDeAlicuota{float64(v.Alicuota), float64(v.Base), float64(v.Importe)})
		}
		if x.Asociado != nil {
			a.Asociado = &Asociado{x.Asociado.Tipo, x.Asociado.PuntoVenta, x.Asociado.Numero, x.Asociado.Fecha}
		}
		auth := AuthXML(Ticket{Token: c.Ticket.Token, Sign: c.Ticket.Sign}, c.Cuit)
		if g := SobreWsfe("FECAESolicitar", CuerpoAutorizar(a, c.Cuit, auth)); g != c.Sobre {
			t.Fatalf("%d: el pedido de CAE no es el mismo:\n--- Go\n%s\n--- TS\n%s", i, g, c.Sobre)
		}
		if g := SobreWsfe("FECompUltimoAutorizado", CuerpoUltimo(auth, x.PuntoVenta, x.Tipo)); g != c.Ultimo {
			t.Fatalf("%d: FECompUltimoAutorizado:\n%s\n%s", i, g, c.Ultimo)
		}
	}
	t.Logf("%d sobres", len(casos))
}

func TestGoldenRespuestas(t *testing.T) {
	var casos []struct {
		XML   string
		Dummy string
		R     json.RawMessage
	}
	cargar(t, "respuestas", &casos)
	for i, c := range casos {
		if c.Dummy != "" {
			var esperado bool
			_ = json.Unmarshal(c.R, &esperado)
			raiz, err := leerXML(c.Dummy)
			if err != nil {
				t.Fatal(err)
			}
			if LeerDummy(raiz.h("Envelope").h("Body")) != esperado {
				t.Fatalf("%d: FEDummy", i)
			}
			continue
		}
		var e struct {
			Autorizado     bool
			Cae            *string
			CaeVencimiento *string
			Observaciones  *string
		}
		_ = json.Unmarshal(c.R, &e)
		raiz, err := leerXML(c.XML)
		if err != nil {
			t.Fatalf("%d: %v", i, err)
		}
		body := raiz.h("Envelope").h("Body")
		if body == nil {
			body = &nodo{hijos: map[string][]*nodo{"_": nil}}
		}
		r := LeerAutorizacion(body)
		de := func(p *string) string {
			if p == nil {
				return ""
			}
			return *p
		}
		venc := ""
		if r.CaeVencimiento != nil {
			venc = r.CaeVencimiento.UTC().Format("2006-01-02T15:04:05.000Z")
		}
		if r.Autorizado != e.Autorizado || r.Cae != de(e.Cae) || venc != de(e.CaeVencimiento) || r.Observaciones != de(e.Observaciones) {
			t.Fatalf("%d:\n%s\nGo %+v (%s)\nTS %s", i, c.XML, r, venc, c.R)
		}
	}
	t.Logf("%d respuestas", len(casos))
}

func TestGoldenWsaa(t *testing.T) {
	var g struct {
		Tickets []struct {
			Ahora  time.Time
			XML    string
			Status int
			R      struct{ Token, Sign, Expira, Error string }
		}
		Tras []struct {
			Ahora                time.Time
			Servicio, Tra, Sobre string
			Cms                  string
		}
	}
	cargar(t, "wsaa", &g)
	for i, c := range g.Tickets {
		tk, err := LeerTicket(c.XML, c.Status, c.Ahora)
		if c.R.Error != "" {
			if err == nil || err.Error() != c.R.Error {
				t.Fatalf("%d: error %v, TS %q", i, err, c.R.Error)
			}
			continue
		}
		if err != nil || tk.Token != c.R.Token || tk.Sign != c.R.Sign || tk.Expira.UTC().Format("2006-01-02T15:04:05.000Z") != c.R.Expira {
			t.Fatalf("%d: %+v %v, TS %+v", i, tk, err, c.R)
		}
	}
	for i, c := range g.Tras {
		if ArmarTra(c.Servicio, c.Ahora) != c.Tra || SobreLoginCms(c.Cms) != c.Sobre {
			t.Fatalf("%d: TRA\n%s\n%s", i, ArmarTra(c.Servicio, c.Ahora), c.Tra)
		}
	}
	if !strings.Contains(g.Tras[0].Tra, "<service>") {
		t.Fatal("TRA vacío")
	}
	_ = reflect.DeepEqual
}
