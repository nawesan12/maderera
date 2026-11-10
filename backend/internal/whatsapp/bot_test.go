package whatsapp

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/asistente"
)

var datosDePrueba = DatosBot{Sitio: "https://mjbj.test", NumeroHumano: "5492235903118"}

func TestBotContestaSoloConDatos(t *testing.T) {
	casos := []struct{ texto, contiene string }{
		{"hola", "asistente de la Maderera"},
		{"a qué hora abren?", "Diagonal Canosa 61"},
		{"aceptan transferencia", "Transferencia"},
		{"me lo cortan a medida?", "https://mjbj.test/corte"},
		{"qué es moldava?", "https://mjbj.test/moldava"},
		{"me hacen factura a?", "CUIT"},
	}
	for _, c := range casos {
		r := Responder(c.texto, EstadoBot{}, datosDePrueba, false)
		if r.Derivar || r.Buscar != "" || !strings.Contains(r.Texto, c.contiene) {
			t.Errorf("%q: %+v", c.texto, r)
		}
	}
}

func TestBotArmaElCorte(t *testing.T) {
	r := Responder("necesito 4 de 600x400 en melamina blanca con canto", EstadoBot{}, datosDePrueba, false)
	if r.Derivar || !strings.Contains(r.Texto, "4 piezas en melamina blanca") ||
		!strings.Contains(r.Texto, "https://mjbj.test/corte#piezas=600x400x4c20&material=melamina+blanca") {
		t.Errorf("corte: %s", r.Texto)
	}
}

func TestBotBuscaYFiltraPorEspesor(t *testing.T) {
	r := Responder("tenés fenólico de 18?", EstadoBot{}, datosDePrueba, false)
	if r.Buscar != "fenolico" {
		t.Fatalf("tendría que pedir el catálogo: %+v", r)
	}
	d := datosDePrueba
	d.Productos = []ProductoBot{
		{Nombre: "Fenólico", Slug: "fenolico", Medidas: []string{"1220 x 2440mm — 12mm", "1220 x 2440mm — 18mm"}},
		{Nombre: "Fenólico film", Slug: "fenolico-film", Medidas: []string{"1220 x 2440mm — 15mm"}},
	}
	r = Responder("tenés fenólico de 18?", EstadoBot{}, d, true)
	if r.Derivar || !strings.Contains(r.Texto, "— 18mm") || strings.Contains(r.Texto, "12mm") || strings.Contains(r.Texto, "Fenólico film") {
		t.Errorf("filtro por espesor: %s", r.Texto)
	}
	if r.Estado.Consulta != "fenolico" {
		t.Errorf("tendría que recordar la consulta: %+v", r.Estado)
	}
}

func TestBotPresupuestaSinMostrarPrecios(t *testing.T) {
	d := datosDePrueba
	d.Productos = []ProductoBot{{Nombre: "Melamina Blanca", Slug: "melamina-blanca", Medidas: []string{"1830 x 2600mm — 18mm"}}}
	r := Responder("cuánto salen 10 placas de melamina blanca de 18", EstadoBot{}, d, true)
	if r.Derivar || r.Presupuestar == nil || strings.Contains(r.Texto, "$") {
		t.Fatalf("precio: %+v", r)
	}
	if p := r.Presupuestar; p.Slug != "melamina-blanca" || p.Cantidad != 10 || p.Medida.EspesorMm != 18 {
		t.Errorf("presupuesto: %+v", p)
	}
	// Con varios productos pregunta cuál.
	d.Productos = append(d.Productos, ProductoBot{Nombre: "Melamina Negra", Slug: "melamina-negra"})
	r = Responder("precio de la melamina", EstadoBot{}, d, true)
	if r.Presupuestar != nil || !strings.Contains(r.Texto, "¿De cuál") {
		t.Errorf("varios: %+v", r)
	}
}

func TestElegirVariantes(t *testing.T) {
	vs := []VarianteBot{{ID: "a", EspesorMm: 15, LargoMm: 2600, AnchoMm: 1830}, {ID: "b", EspesorMm: 18, LargoMm: 2600, AnchoMm: 1830}}
	if got := elegirVariantes(vs, asistente.Medida{EspesorMm: 18}); len(got) != 1 || got[0].ID != "b" {
		t.Errorf("espesor: %+v", got)
	}
	if got := elegirVariantes(vs, asistente.Medida{LargoMm: 1830, AnchoMm: 2600, EspesorMm: 15}); len(got) != 1 || got[0].ID != "a" {
		t.Errorf("medida dada vuelta: %+v", got)
	}
}

func TestBotDerivaAlSegundoNoEntiendo(t *testing.T) {
	r := Responder("asdf qwer", EstadoBot{}, datosDePrueba, true)
	if r.Derivar || r.Estado.Fallos != 1 {
		t.Fatalf("primera vez: %+v", r)
	}
	r = Responder("zxcv uiop", r.Estado, datosDePrueba, true)
	if !r.Derivar || !strings.Contains(r.Texto, "wa.me/5492235903118") {
		t.Errorf("segunda vez: %+v", r)
	}
}

func TestBotPasaAPersonaSiLaPiden(t *testing.T) {
	r := Responder("quiero hablar con una persona", EstadoBot{}, datosDePrueba, false)
	if !r.Derivar || r.Entendio != asistente.Persona {
		t.Errorf("persona: %+v", r)
	}
	sin := datosDePrueba
	sin.NumeroHumano = ""
	r = Responder("quiero hablar con una persona", EstadoBot{}, sin, false)
	if !r.Derivar || strings.Contains(r.Texto, "wa.me") {
		t.Errorf("sin número humano contesta la persona por acá: %+v", r)
	}
}

func TestBotSigueLaConversacion(t *testing.T) {
	r := Responder("y en 15?", EstadoBot{Consulta: "mdf"}, datosDePrueba, false)
	if r.Buscar != "mdf" {
		t.Errorf("«y en 15?» después de mdf: %+v", r)
	}
}

// De punta a punta con la base: con el bot encendido, el entrante queda
// contestado con origen «bot»; al derivar, la conversación pasa a la persona
// y el bot no vuelve a contestar.
func TestBotEnLaBandeja(t *testing.T) {
	e := armar(t, false)
	ctx := e.ctx
	if _, err := e.pool.Exec(ctx, `insert into site_settings (clave, valor) values ('whatsapp_bot', 'si'), ('whatsapp_numero_humano', '+54 9 223 590-3118')`); err != nil {
		t.Fatal(err)
	}
	jid := "5492235550001"
	entra := func(id, texto string) {
		t.Helper()
		if _, err := e.wa.AtenderEntrante(ctx, MensajeMeta{WaMessageID: id, Tipo: "text", Texto: texto}, jid); err != nil {
			t.Fatal(err)
		}
	}
	respuestas := func() []string {
		t.Helper()
		filas, err := e.pool.Query(ctx, `select m.cuerpo from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
			where c.wa_jid = $1 and m.direccion = 'saliente' and m.origen = 'bot' order by m.created_at`, jid)
		if err != nil {
			t.Fatal(err)
		}
		defer filas.Close()
		var out []string
		for filas.Next() {
			var c string
			_ = filas.Scan(&c)
			out = append(out, c)
		}
		return out
	}

	entra("wamid.bot1", "a qué hora abren?")
	if r := respuestas(); len(r) != 1 || !strings.Contains(r[0], "Casa Central") {
		t.Fatalf("horarios: %v", r)
	}
	entra("wamid.bot2", "quiero hablar con una persona")
	r := respuestas()
	if len(r) != 2 || !strings.Contains(r[1], "https://wa.me/5492235903118?text=") {
		t.Fatalf("derivar: %v", r)
	}
	var estado string
	_ = e.pool.QueryRow(ctx, `select bot_estado from whatsapp_conversaciones where wa_jid = $1`, jid).Scan(&estado)
	if estado != "derivada" {
		t.Fatalf("estado: %s", estado)
	}
	entra("wamid.bot3", "hola?")
	if r := respuestas(); len(r) != 2 {
		t.Fatalf("derivada, el bot no contesta: %v", r)
	}
}

// El presupuesto de punta a punta: queda en revisión, con origen whatsapp y
// el precio de la lista; al cliente no le llega ningún número de plata.
func TestBotArmaElPresupuesto(t *testing.T) {
	e := armar(t, false)
	ctx := e.ctx
	if _, err := e.pool.Exec(ctx, `insert into site_settings (clave, valor) values ('whatsapp_bot', 'si')`); err != nil {
		t.Fatal(err)
	}
	e.wa.ConBuscador(
		func(context.Context, string, string) ([]ProductoBot, error) {
			return []ProductoBot{{Nombre: "Melamina Blanca", Slug: "melamina-blanca", Medidas: []string{"1830 x 2600mm — 15mm", "1830 x 2600mm — 18mm"}}}, nil
		},
		func(context.Context, string) (*FichaBot, error) {
			return &FichaBot{Nombre: "Melamina Blanca", Unidad: "placa", Variantes: []VarianteBot{
				{Label: "1830 x 2600mm — 15mm", EspesorMm: 15, Precio: "40000"},
				{Label: "1830 x 2600mm — 18mm", EspesorMm: 18, Precio: "52000.50"},
			}}, nil
		})
	jid := "5492235550002"
	if _, err := e.wa.AtenderEntrante(ctx, MensajeMeta{WaMessageID: "wamid.p1", Tipo: "text", Texto: "cuánto salen 10 placas de melamina blanca?"}, jid); err != nil {
		t.Fatal(err)
	}
	if _, err := e.wa.AtenderEntrante(ctx, MensajeMeta{WaMessageID: "wamid.p2", Tipo: "text", Texto: "de 18"}, jid); err != nil {
		t.Fatal(err)
	}
	var estado, origen, total, descripcion string
	if err := e.pool.QueryRow(ctx, `select q.estado::text, q.origen::text, q.total::text, i.descripcion from quotes q join quote_items i on i.quote_id = q.id
		where q.contacto_telefono = '+5492235550002'`).Scan(&estado, &origen, &total, &descripcion); err != nil {
		t.Fatal(err)
	}
	if estado != "revision" || origen != "whatsapp" || total != "520005.00" || !strings.Contains(descripcion, "18mm") {
		t.Errorf("presupuesto: %s %s %s %s", estado, origen, total, descripcion)
	}
	var salientes string
	_ = e.pool.QueryRow(ctx, `select string_agg(m.cuerpo, ' | ' order by m.created_at) from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
		where c.wa_jid = $1 and m.origen = 'bot'`, jid).Scan(&salientes)
	if strings.Contains(salientes, "52000") || strings.Contains(salientes, "$") || !strings.Contains(salientes, "¿En qué medida") || !strings.Contains(salientes, "te armo el presupuesto") {
		t.Errorf("lo que se le dijo al cliente: %s", salientes)
	}
}
