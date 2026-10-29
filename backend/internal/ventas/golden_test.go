package ventas

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
	"time"

	"mjbj/internal/caja"
)

// El golden de scripts/golden/mostrador.ts: el TS real sobre miles de ventas,
// escalas, formas de venta, fechas y clientes al azar. Go da lo mismo exacto.

type goldenLogica struct {
	Ventas []struct {
		Lineas       []LineaDeVenta `json:"lineas"`
		Medio        string         `json:"medio"`
		Cliente      *string        `json:"cliente"`
		Pedido       float64        `json:"pedido"`
		Pagos        []PagoDeVenta  `json:"pagos"`
		Revisar      *string        `json:"revisar"`
		Subtotal     float64        `json:"subtotal"`
		Rebajadas    []float64      `json:"rebajadas"`
		Descuento    float64        `json:"descuento"`
		Total        float64        `json:"total"`
		Normales     []PagoDeVenta  `json:"normales"`
		RevisarPagos *string        `json:"revisarPagos"`
		Principal    string         `json:"principal"`
		Efectivo     float64        `json:"efectivo"`
		Cuenta       float64        `json:"cuenta"`
	} `json:"ventas"`
	Escalas []struct {
		Lista   []EscalaDePago `json:"lista"`
		Medio   string         `json:"medio"`
		Total   float64        `json:"total"`
		Elegida *EscalaDePago  `json:"elegida"`
		Monto   float64        `json:"monto"`
	} `json:"escalas"`
	Permitidos []struct {
		M         string `json:"m"`
		Mayorista bool   `json:"mayorista"`
		R         bool   `json:"r"`
	} `json:"permitidos"`
	Formas []struct {
		P struct {
			Unit           string  `json:"unit"`
			FormaDeVenta   string  `json:"formaDeVenta"`
			PrecioMediaPct float64 `json:"precioMediaPct"`
			LargoMm        *int    `json:"largoMm"`
			AnchoMm        *int    `json:"anchoMm"`
		} `json:"p"`
		Presentacion *string         `json:"presentacion"`
		Cantidad     float64         `json:"cantidad"`
		Factor       json.RawMessage `json:"factor"`
		Unidades     *float64        `json:"unidades"`
		Precio       float64         `json:"precio"`
		Media        float64         `json:"media"`
	} `json:"formas"`
	Fechas []struct {
		Reclamada time.Time `json:"reclamada"`
		R         time.Time `json:"r"`
	} `json:"fechas"`
	Ordenes []struct {
		Clientes []struct {
			ID          string  `json:"id"`
			Nombre      string  `json:"nombre"`
			RazonSocial *string `json:"razonSocial"`
			Cuit        *string `json:"cuit"`
		} `json:"clientes"`
		Consulta  string   `json:"consulta"`
		Recientes []string `json:"recientes"`
		Puntajes  []int    `json:"puntajes"`
		Orden     []int    `json:"orden"`
	} `json:"ordenes"`
	Normalizados []struct {
		T string `json:"t"`
		R string `json:"r"`
	} `json:"normalizados"`
	Diferencias []struct {
		D float64 `json:"d"`
		R string  `json:"r"`
	} `json:"diferencias"`
}

func leerGolden(t *testing.T) goldenLogica {
	t.Helper()
	crudo, err := os.ReadFile("../../testdata/golden/mostrador/logica.json")
	if err != nil {
		t.Fatal(err)
	}
	var g goldenLogica
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func nulo(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func igualTexto(a, b *string) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func TestGoldenVentas(t *testing.T) {
	g := leerGolden(t)
	if len(g.Ventas) < 1000 {
		t.Fatalf("pocas ventas en el golden: %d", len(g.Ventas))
	}
	for i, c := range g.Ventas {
		if r := nulo(RevisarVenta(c.Lineas, c.Medio, c.Cliente)); !igualTexto(r, c.Revisar) {
			t.Fatalf("venta %d: revisar %v, el TS %v", i, r, c.Revisar)
		}
		if s := TotalDeLaVenta(c.Lineas); s != c.Subtotal {
			t.Fatalf("venta %d: subtotal %v, el TS %v", i, s, c.Subtotal)
		}
		rebajadas, descuento := AplicarDescuento(c.Lineas, c.Pedido)
		for j, l := range rebajadas {
			if l.PrecioUnitario != c.Rebajadas[j] {
				t.Fatalf("venta %d línea %d: precio rebajado %v, el TS %v", i, j, l.PrecioUnitario, c.Rebajadas[j])
			}
		}
		if descuento != c.Descuento || TotalDeLaVenta(rebajadas) != c.Total {
			t.Fatalf("venta %d: descuento %v total %v, el TS %v %v", i, descuento, TotalDeLaVenta(rebajadas), c.Descuento, c.Total)
		}
		normales := NormalizarPagos(c.Pagos, c.Medio, c.Total)
		if !reflect.DeepEqual(normales, c.Normales) {
			t.Fatalf("venta %d: pagos %+v, el TS %+v", i, normales, c.Normales)
		}
		if r := nulo(RevisarPagos(normales, c.Total, c.Cliente)); !igualTexto(r, c.RevisarPagos) {
			t.Fatalf("venta %d: revisar pagos %v, el TS %v", i, r, c.RevisarPagos)
		}
		if p := MedioPrincipal(normales); p != c.Principal {
			t.Fatalf("venta %d: principal %v, el TS %v", i, p, c.Principal)
		}
		if e := ImportePorMedio(normales, Efectivo); e != c.Efectivo {
			t.Fatalf("venta %d: efectivo %v, el TS %v", i, e, c.Efectivo)
		}
		if e := ImportePorMedio(normales, CuentaCorriente); e != c.Cuenta {
			t.Fatalf("venta %d: cuenta %v, el TS %v", i, e, c.Cuenta)
		}
	}
}

func TestGoldenEscalasYFormas(t *testing.T) {
	g := leerGolden(t)
	for i, c := range g.Escalas {
		e := DescuentoPorMedioDePago(c.Lista, c.Medio, c.Total)
		if !reflect.DeepEqual(e, c.Elegida) {
			t.Fatalf("escala %d: %+v, el TS %+v", i, e, c.Elegida)
		}
	}
	for _, c := range g.Permitidos {
		if MedioPermitido(c.M, c.Mayorista) != c.R {
			t.Fatalf("medio %s mayorista %v", c.M, c.Mayorista)
		}
	}
	for i, c := range g.Formas {
		p := ProductoQueSeVende{Unit: c.P.Unit, FormaDeVenta: c.P.FormaDeVenta, PrecioMediaPct: c.P.PrecioMediaPct, LargoMm: c.P.LargoMm, AnchoMm: c.P.AnchoMm}
		f, err := FactorDeStock(p, c.Presentacion)
		var esperado any
		_ = json.Unmarshal(c.Factor, &esperado)
		switch x := esperado.(type) {
		case string:
			if err == nil || err.Error() != x {
				t.Fatalf("forma %d: error %v, el TS %q", i, err, x)
			}
		case float64:
			if err != nil || f != x {
				t.Fatalf("forma %d: factor %v (%v), el TS %v", i, f, err, x)
			}
			if u := UnidadesDeStock(c.Cantidad, f); c.Unidades == nil || u != *c.Unidades {
				t.Fatalf("forma %d: unidades %v, el TS %v", i, u, c.Unidades)
			}
		}
		if m := PrecioDeMedia(c.Precio, c.P.PrecioMediaPct); m != c.Media && !(m == 0 && c.Media == 0) {
			t.Fatalf("forma %d: media %v, el TS %v", i, m, c.Media)
		}
	}
	// El monto del descuento por medio, por separado: con la escala elegida o
	// con un porcentaje suelto.
	for i, c := range g.Escalas {
		var m float64
		if c.Elegida != nil {
			m = MontoDelDescuentoDePago(c.Total, c.Elegida.Porcentaje)
		} else {
			continue
		}
		if m != c.Monto {
			t.Fatalf("escala %d: monto %v, el TS %v", i, m, c.Monto)
		}
	}
}

func TestGoldenFechasClientesArqueo(t *testing.T) {
	g := leerGolden(t)
	ahora := time.Date(2026, 10, 29, 15, 0, 0, 0, time.UTC)
	for i, c := range g.Fechas {
		if r := FechaAcotada(c.Reclamada, ahora); !r.Equal(c.R) {
			t.Fatalf("fecha %d: %v, el TS %v", i, r, c.R)
		}
	}
	for i, c := range g.Ordenes {
		clientes := make([]ClienteOrdenable, len(c.Clientes))
		for j, x := range c.Clientes {
			clientes[j] = ClienteOrdenable{ID: x.ID, Nombre: x.Nombre, RazonSocial: x.RazonSocial, Cuit: x.Cuit}
			if p := PuntajeDeCliente(clientes[j], c.Consulta); p != c.Puntajes[j] {
				t.Fatalf("orden %d cliente %d: puntaje %d, el TS %d", i, j, p, c.Puntajes[j])
			}
		}
		idx := make([]int, len(clientes))
		for j := range idx {
			idx[j] = j
		}
		orden := OrdenarClientes(idx, func(j int) ClienteOrdenable { return clientes[j] }, c.Consulta, c.Recientes)
		// Entre nombres iguales el orden es el de entrada (sort estable),
		// como en JS: se compara por el nombre de cada lugar.
		for j := range orden {
			if clientes[orden[j]].Nombre != clientes[c.Orden[j]].Nombre {
				t.Fatalf("orden %d: %v, el TS %v", i, orden, c.Orden)
			}
		}
	}
	for _, c := range g.Normalizados {
		if r := Normalizar(c.T); r != c.R {
			t.Fatalf("normalizar %q: %q, el TS %q", c.T, r, c.R)
		}
	}
	for _, c := range g.Diferencias {
		if r := caja.NombreDeLaDiferencia(c.D); r != c.R {
			t.Fatalf("diferencia %v: %q, el TS %q", c.D, r, c.R)
		}
	}
	_ = math.Abs
}
