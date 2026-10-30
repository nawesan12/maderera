package pagos

import (
	"encoding/json"
	"net/url"
	"os"
	"reflect"
	"testing"
	"time"
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

// comoJSON pasa algo por JSON y lo vuelve a leer genérico: así se compara
// lo que viaja, sin importar el orden de las claves.
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

func TestGoldenFirma(t *testing.T) {
	var casos []struct {
		Query      string         `json:"query"`
		Cuerpo     any            `json:"cuerpo"`
		Cabecera   *string        `json:"cabecera"`
		RequestID  *string        `json:"requestId"`
		Secreto    *string        `json:"secreto"`
		DataID     *string        `json:"dataId"`
		Leida      *CabeceraFirma `json:"leida"`
		Manifiesto *string        `json:"manifiesto"`
		Valida     bool           `json:"valida"`
	}
	leerGolden(t, "firma.json", &casos)
	ahora := time.UnixMilli(time.Date(2026, 10, 29, 15, 0, 0, 0, time.UTC).UnixMilli())
	for i, c := range casos {
		q, _ := url.ParseQuery(c.Query[1:])
		if got := DataIDDelAviso(q, c.Cuerpo); !reflect.DeepEqual(got, c.DataID) {
			t.Fatalf("%d: dataId %v, el TS %v", i, got, c.DataID)
		}
		cab := ""
		if c.Cabecera != nil {
			cab = *c.Cabecera
		}
		leida := LeerCabeceraFirma(cab)
		if !reflect.DeepEqual(leida, c.Leida) {
			t.Fatalf("%d: cabecera %+v, el TS %+v", i, leida, c.Leida)
		}
		if leida == nil {
			continue
		}
		if m := ManifiestoFirma(c.DataID, c.RequestID, leida.Ts); m != *c.Manifiesto {
			t.Fatalf("%d: manifiesto %q, el TS %q", i, m, *c.Manifiesto)
		}
		secreto := ""
		if c.Secreto != nil {
			secreto = *c.Secreto
		}
		if v := FirmaValida(c.DataID, c.RequestID, leida.Ts, leida.V1, secreto, ahora); v != c.Valida {
			t.Fatalf("%d: válida %v, el TS %v (%+v)", i, v, c.Valida, c)
		}
	}
	if len(casos) < 3000 {
		t.Fatalf("pocos casos: %d", len(casos))
	}
}

func TestGoldenPreferencia(t *testing.T) {
	var casos []struct {
		Solicitud SolicitudPreferencia `json:"solicitud"`
		Cuerpo    any                  `json:"cuerpo"`
	}
	leerGolden(t, "preferencia.json", &casos)
	for i, c := range casos {
		if got := comoJSON(t, ArmarPreferencia(c.Solicitud)); !reflect.DeepEqual(got, c.Cuerpo) {
			t.Fatalf("%d: %v\nel TS %v", i, got, c.Cuerpo)
		}
	}
}

func TestGoldenRemoto(t *testing.T) {
	var g struct {
		Pagos []struct {
			Pago   json.RawMessage `json:"pago"`
			Remoto any             `json:"remoto"`
		} `json:"pagos"`
		Avisos []struct {
			Cuerpo any            `json:"cuerpo"`
			Query  string         `json:"query"`
			MP     *AvisoEntrante `json:"mp"`
			Demo   *AvisoEntrante `json:"demo"`
		} `json:"avisos"`
		Demos []struct {
			ID     string `json:"id"`
			Remoto any    `json:"remoto"`
		} `json:"demos"`
	}
	leerGolden(t, "remoto.json", &g)
	for i, c := range g.Pagos {
		var got any
		if r := PagoDeMercadoPago(c.Pago); r != nil {
			got = comoJSON(t, r)
		}
		if !reflect.DeepEqual(got, c.Remoto) {
			t.Fatalf("pago %d: %v\nel TS %v", i, got, c.Remoto)
		}
	}
	for i, c := range g.Avisos {
		q := url.Values{}
		if c.Query != "" {
			q, _ = url.ParseQuery(c.Query[1:])
		}
		if got := InterpretarAvisoMP(c.Cuerpo, q); !reflect.DeepEqual(got, c.MP) {
			t.Fatalf("aviso %d (%v %s): %+v, el TS %+v", i, c.Cuerpo, c.Query, got, c.MP)
		}
		if got := InterpretarAvisoDemo(c.Cuerpo); !reflect.DeepEqual(got, c.Demo) {
			t.Fatalf("demo %d: %+v, el TS %+v", i, got, c.Demo)
		}
	}
	for _, c := range g.Demos {
		var got any
		if r := ConsultarDemo(c.ID); r != nil {
			got = comoJSON(t, r)
		}
		if !reflect.DeepEqual(got, c.Remoto) {
			t.Fatalf("%s: %v\nel TS %v", c.ID, got, c.Remoto)
		}
	}
}

func TestGoldenDecision(t *testing.T) {
	var casos []struct {
		Actual  string  `json:"actual"`
		Nuestro float64 `json:"nuestro"`
		Remoto  struct {
			Estado string   `json:"estado"`
			Monto  *float64 `json:"monto"`
		} `json:"remoto"`
		Decision Decision `json:"decision"`
		Motivo   string   `json:"motivo"`
	}
	leerGolden(t, "decision.json", &casos)
	for i, c := range casos {
		d, m := Decidir(c.Actual, c.Nuestro, c.Remoto.Estado, c.Remoto.Monto)
		if d != c.Decision || m != c.Motivo {
			t.Fatalf("%d: %s %q, el TS %s %q", i, d, m, c.Decision, c.Motivo)
		}
	}
}
