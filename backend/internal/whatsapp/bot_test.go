package whatsapp

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"mjbj/internal/sqlc"

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

// El despiece del chat queda como consulta de corte: el cliente recibe el
// plano y el aserradero, el aviso. Si una pieza no entra, se dice; si no se
// reconoce la placa, queda el link al cortador.
func TestBotGuardaElCorte(t *testing.T) {
	e := armar(t, false)
	ctx := e.ctx
	if _, err := e.pool.Exec(ctx, `insert into site_settings (clave, valor) values ('whatsapp_bot', 'si')`); err != nil {
		t.Fatal(err)
	}
	e.wa.ConCortes(func(_ context.Context, d asistente.Despiece) (string, string, string, error) {
		switch d.Material {
		case "melamina blanca":
			return "TOKEN123", "Melamina blanca 18mm", "", nil
		case "mdf":
			return "", "MDF 18mm", "Hay una pieza que no entra en la placa. Revisá esa medida.", nil
		}
		return "", "", "", nil
	})
	casos := []struct{ jid, texto, quiere string }{
		{"5492235550011", "4 de 600x400 en melamina blanca con canto", "/corte/c/TOKEN123"},
		{"5492235550012", "2 de 2900x400 en mdf", "no entra"},
		{"5492235550013", "4 de 600x400 en quebracho", "/corte#piezas="},
	}
	for i, c := range casos {
		if _, err := e.wa.AtenderEntrante(ctx, MensajeMeta{WaMessageID: fmt.Sprintf("wamid.c%d", i), Tipo: "text", Texto: c.texto}, c.jid); err != nil {
			t.Fatal(err)
		}
		var r string
		_ = e.pool.QueryRow(ctx, `select m.cuerpo from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
			where c.wa_jid = $1 and m.origen = 'bot'`, c.jid).Scan(&r)
		if !strings.Contains(r, c.quiere) {
			t.Errorf("%q: %q", c.texto, r)
		}
	}
}

// Lo que encontró la revisión del 10/11: cada caso es un error que tenía.
func TestBotRevision(t *testing.T) {
	d := datosDePrueba
	// Acuses y la charla de un pago: silencio, no «No lo encontré».
	for _, txt := range []string{"ok", "dale", "listo gracias", "👍", "ya transferí", "te mando el comprobante", "gracias por tu mensaje, te responderemos a la brevedad"} {
		if r := Responder(txt, EstadoBot{}, d, true); r.Texto != "" || r.Derivar || r.Estado.Fallos != 0 {
			t.Errorf("%q tendría que quedar sin respuesta: %+v", txt, r)
		}
	}
	// Pero «si tienen mdf?» es una consulta.
	if r := Responder("si tienen mdf?", EstadoBot{}, d, false); r.Buscar != "mdf" {
		t.Errorf("«si tienen mdf?»: %+v", r)
	}
	// Con un presupuesto esperando la medida, otro pedido no lo completa.
	pend := &Presupuestar{Slug: "fenolico", Cantidad: 1}
	if r := Responder("mejor pasame precio de mdf de 18", EstadoBot{Pendiente: pend}, d, false); r.Presupuestar != nil {
		t.Errorf("otro producto no completa el pendiente: %+v", r.Presupuestar)
	}
	if r := Responder("la de 18", EstadoBot{Pendiente: pend}, d, false); r.Presupuestar == nil || r.Presupuestar.Medida.EspesorMm != 18 {
		t.Errorf("«la de 18» sí: %+v", r)
	}
	// «pasame info» no es pedir precio.
	if preguntaPrecio("pasame info de melamina blanca") || !preguntaPrecio("pasame el precio de la melamina") {
		t.Error("pasame")
	}
	// Sin el espesor pedido, se muestra igual lo que hay.
	d.Productos = []ProductoBot{{Nombre: "Machimbre", Slug: "machimbre", Medidas: []string{"1/2 x 4 x 3m"}}}
	if r := Responder("tenés machimbre de 18?", EstadoBot{}, d, true); !strings.Contains(r.Texto, "Machimbre") {
		t.Errorf("sin esa medida: %+v", r)
	}
	// El link a la persona no lleva un texto enorme.
	if l := enlaceHumano("5492235903118", strings.Repeat("ñandú ", 500)); len(l) > 3000 {
		t.Errorf("enlace de %d", len(l))
	}
}

func TestProximaApertura(t *testing.T) {
	casos := map[string]string{
		"2026-11-10T10:00:00-03:00": "",               // martes, abierto
		"2026-11-10T20:00:00-03:00": "mañana a las 8", // martes a la noche
		"2026-11-11T06:30:00-03:00": "hoy a las 8",    // miércoles temprano
		"2026-11-14T13:00:00-03:00": "el lunes a las 8",
		"2026-11-15T10:00:00-03:00": "mañana a las 8", // domingo
	}
	for cuando, quiere := range casos {
		ti, _ := time.Parse(time.RFC3339, cuando)
		if got := proximaApertura(ti); got != quiere {
			t.Errorf("%s: %q, quería %q", cuando, got, quiere)
		}
	}
	r := Responder("quiero hablar con una persona", EstadoBot{}, DatosBot{Ahora: mustTime("2026-11-10T20:00:00-03:00"), NumeroHumano: "549223"}, false)
	if !strings.Contains(r.Texto, "cerrados: te contestan mañana a las 8") {
		t.Errorf("fuera de horario: %s", r.Texto)
	}
}

func mustTime(s string) time.Time { t, _ := time.Parse(time.RFC3339, s); return t }

// Las protecciones de atenderConBot, contra la base.
func TestBotSabeCuandoCallarse(t *testing.T) {
	e := armar(t, false)
	ctx := e.ctx
	if _, err := e.pool.Exec(ctx, `insert into site_settings (clave, valor) values ('whatsapp_bot', 'si')`); err != nil {
		t.Fatal(err)
	}
	n := 0
	entra := func(jid, texto string) string {
		t.Helper()
		n++
		id, err := e.wa.AtenderEntrante(ctx, MensajeMeta{WaMessageID: fmt.Sprintf("wamid.calla%d", n), Tipo: "text", Texto: texto}, jid)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	delBot := func(jid string) int {
		var c int
		_ = e.pool.QueryRow(ctx, `select count(*) from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
			where c.wa_jid = $1 and m.origen = 'bot'`, jid).Scan(&c)
		return c
	}
	conv := func(jid string) string {
		var id string
		_ = e.pool.QueryRow(ctx, `select id from whatsapp_conversaciones where wa_jid = $1`, jid).Scan(&id)
		return id
	}

	// El mismo mensaje no se contesta dos veces (el reintento de la cola).
	id := entra("5492235550021", "a qué hora abren?")
	if err := e.wa.atenderConBot(ctx, id, conv("5492235550021"), "5492235550021", "a qué hora abren?"); err != nil {
		t.Fatal(err)
	}
	if c := delBot("5492235550021"); c != 1 {
		t.Errorf("contestó %d veces el mismo mensaje", c)
	}

	// Un mensaje viejo (Meta reintentando tarde) no se contesta.
	viejo := entra("5492235550022", "hola")
	_, _ = e.pool.Exec(ctx, `delete from whatsapp_mensajes where conversacion_id = $1 and origen = 'bot'`, conv("5492235550022"))
	_, _ = e.pool.Exec(ctx, `update whatsapp_mensajes set ocurrido_at = now() - interval '3 hours', datos = null where id = $1`, viejo)
	if err := e.wa.atenderConBot(ctx, viejo, conv("5492235550022"), "5492235550022", "hola"); err != nil {
		t.Fatal(err)
	}
	if c := delBot("5492235550022"); c != 0 {
		t.Errorf("contestó un mensaje de hace 3 horas")
	}

	// Con un aviso automático reciente, es la charla de un pedido: no se mete.
	entra("5492235550023", "hola")
	c23 := conv("5492235550023")
	_, _ = e.pool.Exec(ctx, `insert into whatsapp_mensajes (conversacion_id, direccion, tipo, cuerpo, estado, origen, ocurrido_at)
		values ($1, 'saliente', 'text', 'Tu pedido está listo', 'enviado', 'aviso', now())`, c23)
	antes := delBot("5492235550023")
	entra("5492235550023", "a qué hora abren?")
	if delBot("5492235550023") != antes {
		t.Error("contestó en la charla de un aviso de pedido")
	}

	// Asignada a alguien: tampoco.
	entra("5492235550024", "hola")
	e.staff(t, "vera@prueba.test", sqlc.StaffRoleVendedor)
	if _, err := e.pool.Exec(ctx, `update whatsapp_conversaciones set asignado_a_user_id = (select id from "user" where email = 'vera@prueba.test') where id = $1`, conv("5492235550024")); err != nil {
		t.Fatal(err)
	}
	antes = delBot("5492235550024")
	entra("5492235550024", "a qué hora abren?")
	if delBot("5492235550024") != antes {
		t.Error("contestó una conversación asignada")
	}

	// El tope por hora: pasado, se frena y pasa a una persona.
	jid := "5492235550025"
	for i := 0; i < TopeBotPorHora+3; i++ {
		entra(jid, "a qué hora abren?")
	}
	var estado string
	_ = e.pool.QueryRow(ctx, `select bot_estado from whatsapp_conversaciones where wa_jid = $1`, jid).Scan(&estado)
	if c := delBot(jid); c != TopeBotPorHora || estado != "derivada" {
		t.Errorf("tope: contestó %d (tope %d), estado %s", c, TopeBotPorHora, estado)
	}
}
