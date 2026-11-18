package whatsapp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"mjbj/internal/asistente"
)

// Hallazgo 24 (T7): el bot cotizaba los m² o los metros como si fueran
// unidades. «6 m² de fenólico» salía como 6 placas.

func TestCantidadPedidaConUnidad(t *testing.T) {
	casos := []struct {
		texto  string
		cant   float64
		unidad string
	}{
		{"cuanto salen 6 m² de fenolico", 6, "m2"},
		{"precio de 2,5 m2 de deck", 2.5, "m2"},
		{"3.75 m de zocalo cuanto sale", 3.75, "m"},
		{"1.000 metros de zócalo precio", 1000, "m"},
		{"cuanto salen 1.000 placas de melamina", 1000, ""},
		{"10 placas de melamina", 10, ""},
		// Las medidas no son cantidades.
		{"precio 1 fenolico 1.830x2.600", 1, ""},
		{"cuanto salen 2 placas de 2.440", 2, ""},
		{"placa de 18 mm 1.830x2.600 precio", 1, ""},
	}
	for _, c := range casos {
		cant, unidad := cantidadPedida(c.texto, asistente.Entender(c.texto))
		if cant != c.cant || unidad != c.unidad {
			t.Errorf("%q: %v %q, quería %v %q", c.texto, cant, unidad, c.cant, c.unidad)
		}
	}
}

func TestCantidadEnUnidadDeVenta(t *testing.T) {
	placa := VarianteBot{Label: "1830 x 2600mm — 18mm", LargoMm: 2600, AnchoMm: 1830, EspesorMm: 18}
	sinMedida := VarianteBot{Label: "18mm", EspesorMm: 18}
	casos := []struct {
		nombre      string
		cant        float64
		dicha, alta string
		v           VarianteBot
		ok          bool
		quiere      float64
		convertida  bool
	}{
		{"m² de placa: placas enteras para arriba", 6, "m2", "placa", placa, true, 2, true},
		{"m² justos de una placa", 4.758, "m2", "placa", placa, true, 1, true},
		{"m² de deck por m²", 6, "m2", "metro_cuadrado", VarianteBot{}, true, 6, false},
		{"metros de zócalo por metro", 1000, "m", "metro_lineal", VarianteBot{}, true, 1000, false},
		{"metros de melamina", 12, "m", "placa", placa, false, 0, false},
		{"m² de una placa sin medida", 6, "m2", "placa", sinMedida, false, 0, false},
		{"m² de algo por unidad", 6, "m2", "unidad", VarianteBot{}, false, 0, false},
		{"metros de algo por m²", 6, "m", "metro_cuadrado", VarianteBot{}, false, 0, false},
		{"sin unidad: como antes", 10, "", "placa", placa, true, 10, false},
		{"tope de unidades", 201, "", "placa", placa, false, 0, false},
		{"en el tope", 200, "", "placa", placa, true, 200, false},
		{"tope de metros", 2001, "m", "metro_lineal", VarianteBot{}, false, 0, false},
		{"m² que pasan el tope en placas", 1000, "m2", "placa", placa, false, 0, false},
	}
	for _, c := range casos {
		got, ok := cantidadEnUnidadDeVenta(c.cant, c.dicha, c.alta, c.v)
		if ok != c.ok || got.Cantidad != c.quiere || got.Convertida != c.convertida {
			t.Errorf("%s: %+v %v", c.nombre, got, ok)
		}
	}
	got, _ := cantidadEnUnidadDeVenta(6, "m2", "placa", placa)
	// Al cliente: lo que pidió y lo que cubren las placas, con coma.
	if a := aclaracionDeLaConversion(got); a != " Pediste 6 m²: 2 placas enteras cubren 9,52 m²." {
		t.Errorf("aclaración: %q", a)
	}
	got, _ = cantidadEnUnidadDeVenta(2.5, "m2", "placa", placa)
	if a := aclaracionDeLaConversion(got); a != " Pediste 2,5 m²: 1 placa entera cubre 4,76 m²." {
		t.Errorf("aclaración con decimales: %q", a)
	}
	if n := notaDelBot(Presupuestar{Texto: "6 m2 de fenolico"}, got); !strings.Contains(n, "Pidió 2,5 m²") || !strings.Contains(n, "cubren 4,76 m²") {
		t.Errorf("nota: %q", n)
	}
	if m := motivoSinCotizar(Presupuestar{Cantidad: 12, Unidad: "m"}, "placa", placa); m != "Pidió 12 m y se vende por placa: no se cotizó." {
		t.Errorf("motivo: %q", m)
	}
	if m := motivoSinCotizar(Presupuestar{Cantidad: 6, Unidad: "m2"}, "placa", sinMedida); !strings.Contains(m, "no tiene medida") {
		t.Errorf("motivo sin medida: %q", m)
	}
	if m := motivoSinCotizar(Presupuestar{Cantidad: 1000}, "placa", placa); !strings.Contains(m, "tope") {
		t.Errorf("motivo del tope: %q", m)
	}
}

// Un pendiente guardado antes de T7 no tiene «unidad»: se sigue leyendo,
// como unidades.
func TestPendienteViejoSinUnidad(t *testing.T) {
	var p Presupuestar
	if err := json.Unmarshal([]byte(`{"slug":"fenolico","medida":{},"cantidad":3,"texto":"3 fenolicos"}`), &p); err != nil || p.Unidad != "" || p.Cantidad != 3 {
		t.Fatalf("%+v %v", p, err)
	}
	r := Responder("de 18", EstadoBot{Pendiente: &p}, datosDePrueba, false)
	if r.Presupuestar == nil || r.Presupuestar.Cantidad != 3 || r.Presupuestar.Unidad != "" || r.Presupuestar.Medida.EspesorMm != 18 {
		t.Errorf("pendiente viejo: %+v", r.Presupuestar)
	}
	// La medida que llega con m² trae la unidad.
	r = Responder("de 18, 6 m2", EstadoBot{Pendiente: &p}, datosDePrueba, false)
	if r.Presupuestar == nil || r.Presupuestar.Cantidad != 6 || r.Presupuestar.Unidad != "m2" {
		t.Errorf("pendiente con m²: %+v", r.Presupuestar)
	}
}

// De punta a punta: «6 m² de fenólico» queda en 2 placas con la nota, y al
// cliente se le dice qué cubren; «12 metros de melamina» pasa a una persona
// sin presupuesto.
func TestBotPresupuestaMetrosCuadrados(t *testing.T) {
	e := armar(t, false)
	ctx := e.ctx
	if _, err := e.pool.Exec(ctx, `insert into site_settings (clave, valor) values ('whatsapp_bot', 'si')`); err != nil {
		t.Fatal(err)
	}
	e.wa.ConBuscador(
		func(_ context.Context, consulta, _ string) ([]ProductoBot, error) {
			if strings.Contains(consulta, "melamina") {
				return []ProductoBot{{Nombre: "Melamina Blanca", Slug: "melamina-blanca", Medidas: []string{"1830 x 2600mm — 18mm"}}}, nil
			}
			return []ProductoBot{{Nombre: "Fenólico", Slug: "fenolico", Medidas: []string{"1830 x 2600mm — 18mm"}}}, nil
		},
		func(_ context.Context, slug string) (*FichaBot, error) {
			return &FichaBot{Nombre: map[string]string{"fenolico": "Fenólico", "melamina-blanca": "Melamina Blanca"}[slug], Unidad: "placa", Variantes: []VarianteBot{
				{Label: "1830 x 2600mm — 18mm", EspesorMm: 18, LargoMm: 2600, AnchoMm: 1830, Precio: "50000"},
			}}, nil
		})
	if _, err := e.wa.AtenderEntrante(ctx, MensajeMeta{WaMessageID: "wamid.m2a", Tipo: "text", Texto: "cuánto salen 6 m² de fenólico?"}, "5492235550021"); err != nil {
		t.Fatal(err)
	}
	var cantidad, total, notas string
	if err := e.pool.QueryRow(ctx, `select i.cantidad::float8::text, q.total::text, q.notas from quotes q join quote_items i on i.quote_id = q.id
		where q.contacto_telefono = '+5492235550021'`).Scan(&cantidad, &total, &notas); err != nil {
		t.Fatal(err)
	}
	if cantidad != "2" || total != "100000.00" || !strings.Contains(notas, "Pidió 6 m²") || !strings.Contains(notas, "9,52 m²") {
		t.Errorf("presupuesto: %s %s %q", cantidad, total, notas)
	}
	var dicho string
	_ = e.pool.QueryRow(ctx, `select m.cuerpo from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
		where c.wa_jid = '5492235550021' and m.origen = 'bot'`).Scan(&dicho)
	if !strings.Contains(dicho, "*2 × Fenólico") || !strings.Contains(dicho, "cubren 9,52 m²") || strings.Contains(dicho, "$") {
		t.Errorf("al cliente: %q", dicho)
	}

	if _, err := e.wa.AtenderEntrante(ctx, MensajeMeta{WaMessageID: "wamid.m2b", Tipo: "text", Texto: "precio de 12 metros de melamina blanca"}, "5492235550022"); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = e.pool.QueryRow(ctx, `select count(*) from quotes where contacto_telefono = '+5492235550022'`).Scan(&n)
	var estado string
	_ = e.pool.QueryRow(ctx, `select bot_estado from whatsapp_conversaciones where wa_jid = '5492235550022'`).Scan(&estado)
	if n != 0 || estado != "derivada" {
		t.Errorf("12 metros de melamina: %d presupuestos, %s", n, estado)
	}
}
