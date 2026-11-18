package whatsapp

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

// Las reglas para mandar menos mensajes (18/11/2026): cada prueba es una
// regla, y casi todas cuentan cuántos mensajes salieron.

func TestJuntarRespuestas(t *testing.T) {
	d := datosDePrueba
	horario := Responder("a qué hora abren?", EstadoBot{}, d, false)
	pagos := Responder("aceptan transferencia", EstadoBot{}, d, false)
	hola := Responder("hola", EstadoBot{}, d, false)
	nada := Responder("asdf qwer", EstadoBot{}, d, true)
	if !nada.NoEntendio {
		t.Fatalf("«asdf» tendría que ser un no entendí: %+v", nada)
	}

	// «hola» + «a qué hora abren?» + «aceptan transferencia»: un mensaje, sin
	// el saludo largo y con las dos respuestas.
	tu := JuntarRespuestas([]RespuestaBot{hola, horario, pagos}, []string{"hola", "a qué hora abren?", "aceptan transferencia"}, nil, EstadoBot{}, d, nil)
	if len(tu.Partes) != 2 || !strings.HasPrefix(tu.Partes[0], "¡Hola! Estamos en:") || !strings.Contains(tu.Partes[1], "Transferencia") {
		t.Errorf("ráfaga: %q", tu.Partes)
	}

	// Lo que no se entendió no se dice si otra cosa sí, ni suma un fallo.
	tu = JuntarRespuestas([]RespuestaBot{nada, horario}, []string{"asdf qwer", "a qué hora abren?"}, nil, EstadoBot{}, d, nil)
	if len(tu.Partes) != 1 || strings.Contains(tu.Partes[0], "No lo encontré") || tu.Estado.Fallos != 0 {
		t.Errorf("no entendí + horario: %+v", tu)
	}

	// La misma pregunta dos veces en la ráfaga: una respuesta.
	tu = JuntarRespuestas([]RespuestaBot{horario, horario}, []string{"abren?", "a qué hora abren?"}, nil, EstadoBot{}, d, nil)
	if len(tu.Partes) != 1 {
		t.Errorf("repetida: %q", tu.Partes)
	}

	// Pasar a una persona va al final, con todo lo escrito en el enlace.
	persona := Responder("quiero hablar con alguien", EstadoBot{}, d, false)
	tu = JuntarRespuestas([]RespuestaBot{horario, persona}, []string{"a qué hora abren?", "quiero hablar con alguien"}, nil, EstadoBot{}, d, nil)
	if !tu.Derivar || len(tu.Partes) != 2 || !strings.Contains(tu.Partes[1], "wa.me/5492235903118") ||
		!strings.Contains(tu.Partes[1], "abren") || !strings.Contains(tu.Partes[1], "alguien") {
		t.Errorf("derivar: %+v", tu)
	}

	// Lo que ya se le dijo hace un rato no se repite.
	tu = JuntarRespuestas([]RespuestaBot{horario}, []string{"a qué hora abren?"}, nil, EstadoBot{}, d, []string{"¡Hola! " + horario.Texto})
	if len(tu.Partes) != 0 {
		t.Errorf("ya dicho: %q", tu.Partes)
	}
	tu = JuntarRespuestas([]RespuestaBot{hola}, []string{"hola"}, nil, EstadoBot{}, d, []string{hola.Texto})
	if len(tu.Partes) != 0 {
		t.Errorf("el saludo dos veces: %q", tu.Partes)
	}
}

func TestBotEnModoAhorro(t *testing.T) {
	d := datosDePrueba
	d.Ahorro = true
	if r := Responder("hola", EstadoBot{}, d, false); r.Texto != "" || r.Derivar {
		t.Errorf("en ahorro, un «hola» no se contesta: %+v", r)
	}
	if r := Responder("asdf qwer", EstadoBot{}, d, true); !r.Derivar {
		t.Errorf("en ahorro, lo que no entiende se deriva a la primera: %+v", r)
	}
	if r := Responder("a qué hora abren?", EstadoBot{}, d, false); !strings.Contains(r.Texto, "Casa Central") {
		t.Errorf("lo esencial se contesta igual: %+v", r)
	}
}

func TestBotNoContestaAcusesNiContestadores(t *testing.T) {
	d := datosDePrueba
	for _, txt := range []string{"jaja ok", "oki gracias", "mil gracias!!", "graciasss", "👌🏻", "🙏", "dale genial", "perfecto muchas gracias", "joya", "okk"} {
		if r := Responder(txt, EstadoBot{}, d, true); r.Texto != "" || r.Derivar || r.Buscar != "" {
			t.Errorf("%q tendría que quedar sin respuesta: %+v", txt, r)
		}
	}
	for _, txt := range []string{
		"Este es un mensaje automático. Te responderemos a la brevedad.",
		"Gracias por comunicarte con Ferretería López. En breve te contestamos.",
		"Estamos fuera del horario de atención.",
		"No estoy disponible en este momento",
	} {
		if r := Responder(txt, EstadoBot{Fallos: 1}, d, true); r.Texto != "" || r.Derivar || r.Estado.Fallos != 1 {
			t.Errorf("%q es otro contestador: %+v", txt, r)
		}
	}
	if !esEco("Se puede pagar con: Efectivo", []string{"Se puede pagar con: Efectivo"}) || esEco("hola", []string{"hola"}) {
		t.Error("eco")
	}
}

func TestCalcularUso(t *testing.T) {
	casos := []struct {
		usados, tope      int
		ahorro, alcanzado bool
	}{
		{0, 1000, false, false},
		{799, 1000, false, false},
		{800, 1000, true, false},
		{999, 1000, true, false},
		{1000, 1000, true, true},
		{5, 0, true, true},
	}
	for _, c := range casos {
		u := CalcularUso(c.usados, c.tope)
		if u.Ahorro != c.ahorro || u.Alcanzado != c.alcanzado {
			t.Errorf("%d de %d: %+v", c.usados, c.tope, u)
		}
	}
	for v, n := range map[string]int{"1000": 1000, " 500 ": 500, "": 1000, "mil": 1000, "-3": 1000, "0": 0} {
		if got := LeerTopeMensajes(v); got != n {
			t.Errorf("LeerTopeMensajes(%q) = %d", v, got)
		}
	}
}

func TestClasificarEntrante(t *testing.T) {
	tr, vacio := "a qué hora abren", ""
	casos := []struct {
		tipo, cuerpo string
		tr           *string
		fallido      bool
		clase        claseEntrante
		conArchivo   bool
	}{
		{"text", "hola", nil, false, entranteTexto, false},
		{"text", "  ", nil, false, entranteIgnorar, false},
		{"image", "", nil, false, entranteArchivo, false},
		{"image", "tienen esto?", nil, false, entranteTexto, true},
		{"location", "Ubicación: Av. Colón 1234", nil, false, entranteArchivo, false},
		{"contacts", "Contacto: Juan", nil, false, entranteArchivo, false},
		{"sticker", "", nil, false, entranteIgnorar, false},
		{"audio", "", &tr, false, entranteTexto, false},
		{"audio", "", &vacio, false, entranteAudioSinTexto, false},
		{"audio", "", nil, true, entranteAudioSinTexto, false},
		{"unsupported", "(Mandó un mensaje que WhatsApp no deja ver acá)", nil, false, entranteNoVisible, false},
	}
	for _, c := range casos {
		clase, _, conArchivo := clasificarEntrante(c.tipo, c.cuerpo, c.tr, c.fallido)
		if clase != c.clase || conArchivo != c.conArchivo {
			t.Errorf("%s %q: %d %v", c.tipo, c.cuerpo, clase, conArchivo)
		}
	}
}

// entornoDelBot arma la base con el bot encendido y un par de ayudas.
type entornoDelBot struct {
	*entorno
	t *testing.T
	n int
}

func armarBot(t *testing.T) *entornoDelBot {
	e := armar(t, false)
	if _, err := e.pool.Exec(e.ctx, `insert into site_settings (clave, valor) values ('whatsapp_bot', 'si'), ('whatsapp_numero_humano', '5492235903118')`); err != nil {
		t.Fatal(err)
	}
	return &entornoDelBot{entorno: e, t: t}
}

func (b *entornoDelBot) entra(jid string, m MensajeMeta) {
	b.t.Helper()
	b.n++
	if m.WaMessageID == "" {
		m.WaMessageID = fmt.Sprintf("wamid.ahorro%d", b.n)
	}
	if m.Tipo == "" {
		m.Tipo = "text"
	}
	if _, err := b.wa.AtenderEntrante(b.ctx, m, jid); err != nil {
		b.t.Fatal(err)
	}
}

func (b *entornoDelBot) texto(jid, texto string) { b.entra(jid, MensajeMeta{Texto: texto}) }

func (b *entornoDelBot) delBot(jid string) []string {
	b.t.Helper()
	filas, err := b.pool.Query(b.ctx, `select m.cuerpo from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
		where c.wa_jid = $1 and m.direccion = 'saliente' and m.origen = 'bot' order by m.created_at`, jid)
	if err != nil {
		b.t.Fatal(err)
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

func (b *entornoDelBot) estado(jid string) string {
	var e string
	_ = b.pool.QueryRow(b.ctx, `select bot_estado from whatsapp_conversaciones where wa_jid = $1`, jid).Scan(&e)
	return e
}

// Tres mensajes seguidos, una respuesta. Y si sigue escribiendo, el turno se
// corre hasta que pare.
func TestBotJuntaLasRafagas(t *testing.T) {
	b := armarBot(t)
	b.wa.rafaga = 300 * time.Millisecond
	jid := "5492235550101"
	b.texto(jid, "hola")
	b.texto(jid, "a qué hora abren?")
	b.texto(jid, "aceptan transferencia?")
	if r := b.delBot(jid); len(r) != 0 {
		t.Fatalf("contestó antes de que termine de escribir: %q", r)
	}
	time.Sleep(400 * time.Millisecond)
	b.procesar(t)
	r := b.delBot(jid)
	if len(r) != 1 || !strings.Contains(r[0], "Casa Central") || !strings.Contains(r[0], "Transferencia") || !strings.HasPrefix(r[0], "¡Hola!") {
		t.Fatalf("tres mensajes, una respuesta con todo: %q", r)
	}

	// Sigue escribiendo: el turno del primero se corre.
	jid = "5492235550102"
	b.texto(jid, "hola")
	time.Sleep(350 * time.Millisecond)
	b.texto(jid, "hacen factura a?")
	b.procesar(t)
	if r := b.delBot(jid); len(r) != 0 {
		t.Fatalf("contestó con el cliente todavía escribiendo: %q", r)
	}
	time.Sleep(1200 * time.Millisecond)
	b.procesar(t)
	if r := b.delBot(jid); len(r) != 1 || !strings.Contains(r[0], "CUIT") {
		t.Fatalf("después de la pausa, una respuesta: %q", r)
	}
	// Los turnos que quedaron en la cola no contestan de nuevo.
	time.Sleep(400 * time.Millisecond)
	b.procesar(t)
	if r := b.delBot(jid); len(r) != 1 {
		t.Fatalf("un turno viejo contestó otra vez: %q", r)
	}
}

// El mismo webhook dos veces (Meta reintenta): una respuesta.
func TestBotWebhookRepetido(t *testing.T) {
	b := armarBot(t)
	jid := "5492235550103"
	m := MensajeMeta{WaMessageID: "wamid.repetido", Texto: "a qué hora abren?"}
	b.entra(jid, m)
	b.entra(jid, m)
	if r := b.delBot(jid); len(r) != 1 {
		t.Errorf("el mismo wamid contestado %d veces", len(r))
	}
}

// La misma pregunta en dos turnos: la segunda vez, silencio. Lo que el cliente
// manda y es lo mismo que dijo el bot (otro bot repitiendo), también.
func TestBotNoRepite(t *testing.T) {
	b := armarBot(t)
	jid := "5492235550104"
	b.texto(jid, "a qué hora abren?")
	b.texto(jid, "a que hora abren")
	b.texto(jid, "me hacen factura a?")
	r := b.delBot(jid)
	if len(r) != 2 || !strings.Contains(r[1], "CUIT") {
		t.Fatalf("la misma respuesta no se repite: %q", r)
	}
	b.texto(jid, r[1])
	if r := b.delBot(jid); len(r) != 2 {
		t.Errorf("le contestó a su propio eco: %q", r)
	}
}

// Lo que no es texto: una respuesta útil (o ninguna), nunca un error.
func TestBotConLoQueNoEsTexto(t *testing.T) {
	b := armarBot(t)
	casos := []struct {
		jid, tipo, cuerpo string
		quiere            string
		derivada          bool
	}{
		{"5492235550111", "location", "Ubicación: Av. Colón 1234", textoArchivo, true},
		{"5492235550112", "image", "", textoArchivo, true},
		{"5492235550113", "contacts", "Contacto: Juan Pérez", textoArchivo, true},
		{"5492235550114", "unsupported", "(Mandó un mensaje que WhatsApp no deja ver acá)", textoNoVisible, false},
		{"5492235550115", "sticker", "", "", false},
	}
	for _, c := range casos {
		b.entra(c.jid, MensajeMeta{Tipo: c.tipo, Texto: c.cuerpo})
		r := b.delBot(c.jid)
		switch {
		case c.quiere == "" && len(r) != 0:
			t.Errorf("%s: no tendría que contestar: %q", c.tipo, r)
		case c.quiere != "" && (len(r) != 1 || !strings.HasPrefix(r[0], c.quiere)):
			t.Errorf("%s: %q", c.tipo, r)
		}
		if got := b.estado(c.jid) == "derivada"; got != c.derivada {
			t.Errorf("%s: derivada %v", c.tipo, got)
		}
	}
}

// El contador del mes: al 80 %, ahorro; al 100 %, el bot no manda nada y los
// envíos de la bandeja piden confirmación.
func TestBotTopeDeMensajes(t *testing.T) {
	b := armarBot(t)
	ctx := b.ctx
	if _, err := b.pool.Exec(ctx, `update site_settings set valor = '10' where clave = 'whatsapp_tope_mensajes'`); err != nil {
		t.Fatal(err)
	}
	conv, err := b.wa.ConversacionDe(ctx, "5492235550120", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	salen := func(n int, origen, estado string) {
		t.Helper()
		if _, err := b.pool.Exec(ctx, `insert into whatsapp_mensajes (conversacion_id, direccion, tipo, cuerpo, estado, origen, ocurrido_at)
			select $1, 'saliente', 'text', 'x', $3::estado_mensaje, $4, now() - interval '13 hours' from generate_series(1, $2::int)`, conv.ID, n, estado, origen); err != nil {
			t.Fatal(err)
		}
	}
	// Del teléfono y los fallidos no cuentan.
	salen(7, "panel", "enviado")
	salen(5, "telefono", "enviado")
	salen(5, "bot", "fallido")
	u, err := b.wa.UsoDelMes(ctx, b.wa.ahora())
	if err != nil || u.Usados != 7 || u.Tope != 10 || u.Ahorro {
		t.Fatalf("uso: %+v %v", u, err)
	}

	salen(1, "bot", "enviado") // 8 de 10: ahorro
	jid := "5492235550121"
	b.texto(jid, "hola")
	if r := b.delBot(jid); len(r) != 0 {
		t.Errorf("en ahorro no saluda: %q", r)
	}
	b.texto(jid, "asdf qwer")
	if r := b.delBot(jid); len(r) != 1 || !strings.Contains(r[0], "wa.me") {
		t.Errorf("en ahorro deriva a la primera: %q", r)
	}

	salen(2, "panel", "enviado") // 10 de 10, con la derivación 11: tope
	jid = "5492235550122"
	b.texto(jid, "a qué hora abren?")
	if r := b.delBot(jid); len(r) != 0 {
		t.Errorf("con el tope, el bot no manda: %q", r)
	}
	if !b.wa.TopeAlcanzado(ctx) {
		t.Error("la bandeja tendría que pedir confirmación")
	}
}

// Fuera de horario, en una conversación que atiende una persona: un aviso de
// cerrado, una sola vez, y no por un «ok».
func TestBotAvisaCerradoUnaVez(t *testing.T) {
	b := armarBot(t)
	ctx := b.ctx
	noche := mustTime("2026-11-17T20:00:00-03:00") // martes
	b.wa.ahora = func() time.Time { return noche }
	ahora := float64(time.Now().UnixMilli())
	entra := func(jid, texto string) {
		t.Helper()
		b.entra(jid, MensajeMeta{Texto: texto, Ocurrido: &ahora})
	}
	jid := "5492235550131"
	conv, _ := b.wa.ConversacionDe(ctx, jid, nil, nil)
	if _, err := b.pool.Exec(ctx, `update whatsapp_conversaciones set bot_estado = 'derivada' where id = $1`, conv.ID); err != nil {
		t.Fatal(err)
	}
	entra(jid, "ok")
	if r := b.delBot(jid); len(r) != 0 {
		t.Fatalf("un «ok» no lleva aviso: %q", r)
	}
	entra(jid, "tienen mdf de 18?")
	entra(jid, "y fenolico?")
	r := b.delBot(jid)
	if len(r) != 1 || r[0] != "Ahora estamos cerrados: te contestamos mañana a las 8." {
		t.Fatalf("un aviso de cerrado: %q", r)
	}
	// Al día siguiente, de nuevo cerrado, sí vuelve a avisar.
	b.wa.ahora = func() time.Time { return noche.Add(24 * time.Hour) }
	entra(jid, "hola? sigue en pie lo del mdf?")
	if r := b.delBot(jid); len(r) != 2 {
		t.Errorf("otra noche, otro aviso: %q", r)
	}
}

// Una respuesta que no salió por un problema pasajero se reintenta sobre la
// misma fila: nunca dos burbujas, y con límite.
func TestBotReintentaSinDuplicar(t *testing.T) {
	b := armarBot(t)
	ctx := b.ctx
	p := &proveedorQueFalla{Demo: &Demo{}, fallas: 1}
	b.wa.ConProveedor(p)
	jid := "5492235550141"
	b.texto(jid, "a qué hora abren?")
	var id, estado string
	if err := b.pool.QueryRow(ctx, `select m.id, m.estado::text from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
		where c.wa_jid = $1 and m.origen = 'bot'`, jid).Scan(&id, &estado); err != nil || estado != "fallido" {
		t.Fatalf("primer envío: %s %v", estado, err)
	}
	var encolados int
	_ = b.pool.QueryRow(ctx, `select count(*) from trabajos where tipo = $1`, TrabajoReenvio).Scan(&encolados)
	if encolados != 1 {
		t.Fatalf("reintentos encolados: %d", encolados)
	}
	if err := b.wa.reenviar(ctx, cargaReenvio{id, 1}); err != nil {
		t.Fatal(err)
	}
	if err := b.wa.reenviar(ctx, cargaReenvio{id, 1}); err != nil {
		t.Fatal(err)
	}
	r := b.delBot(jid)
	_ = b.pool.QueryRow(ctx, `select estado::text from whatsapp_mensajes where id = $1`, id).Scan(&estado)
	if len(r) != 1 || estado != "enviado" || p.enviados != 1 {
		t.Errorf("reintento: %d burbujas, estado %s, %d enviados", len(r), estado, p.enviados)
	}

	// Siempre falla: tres reintentos y queda para una persona.
	p.fallas = 100
	jid = "5492235550142"
	b.texto(jid, "aceptan transferencia?")
	_ = b.pool.QueryRow(ctx, `select m.id from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
		where c.wa_jid = $1 and m.origen = 'bot'`, jid).Scan(&id)
	for i := 1; i <= MaxReenvios; i++ {
		if err := b.wa.reenviar(ctx, cargaReenvio{id, i}); err != nil {
			t.Fatal(err)
		}
	}
	_ = b.pool.QueryRow(ctx, `select count(*) from trabajos where tipo = $1 and carga->>'mensajeId' = $2`, TrabajoReenvio, id).Scan(&encolados)
	if encolados != MaxReenvios {
		t.Errorf("reintentos de una que siempre falla: %d", encolados)
	}
}

type proveedorQueFalla struct {
	*Demo
	fallas, enviados int
}

func (p *proveedorQueFalla) Enviar(ctx context.Context, destino string, m Saliente) (string, *ErrorDeEnvio) {
	if p.fallas > 0 {
		p.fallas--
		c := 131016.0
		e := ExplicarError(&c, "")
		return "", &ErrorDeEnvio{Codigo: e.Codigo, Texto: e.Texto, Accion: e.Accion}
	}
	p.enviados++
	return p.Demo.Enviar(ctx, destino, m)
}
