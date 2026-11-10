package whatsapp

import (
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

func TestBotNoDaPreciosYDeriva(t *testing.T) {
	d := datosDePrueba
	d.Productos = []ProductoBot{{Nombre: "Melamina Blanca", Slug: "melamina-blanca", Medidas: []string{"18mm"}}}
	r := Responder("cuánto sale la melamina blanca", EstadoBot{}, d, true)
	if !r.Derivar || !strings.Contains(r.Texto, "https://wa.me/5492235903118?text=") || strings.Contains(r.Texto, "$") {
		t.Errorf("precio: %+v", r)
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
