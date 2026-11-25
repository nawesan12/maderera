package whatsapp

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"mjbj/internal/push"
	"mjbj/internal/sqlc"
)

// Cuando algo falla (18/11/2026, la revisión del bot). Dos reglas: ningún
// cliente queda sin respuesta en silencio —si el bot no puede contestar, pasa
// a una persona y se avisa—, y nunca se manda dos veces lo mismo, porque
// cada mensaje se paga.

// conAvisos conecta un avisador sin claves: cada aviso queda en la bitácora
// (omitido), y la prueba puede contarlos.
func (b *entornoDelBot) conAvisos() {
	b.wa.push = push.Nuevo(push.Config{}, sqlc.New(b.pool), silencio)
}

func (b *entornoDelBot) avisos(titulo string) int {
	b.t.Helper()
	var n int
	if err := b.pool.QueryRow(b.ctx, `select count(*)::int from notifications_log where asunto = $1`, titulo).Scan(&n); err != nil {
		b.t.Fatal(err)
	}
	return n
}

func (b *entornoDelBot) conv(jid string) string {
	var id string
	_ = b.pool.QueryRow(b.ctx, `select id from whatsapp_conversaciones where wa_jid = $1`, jid).Scan(&id)
	return id
}

const tituloNoSalio = "WhatsApp: el bot no pudo contestar"

// La base falla al guardar la respuesta, después de armar el presupuesto: los
// mensajes vuelven a quedar sin ver, el reintento contesta, y el presupuesto
// es uno solo.
func TestBotFallaLaBaseAntesDeContestar(t *testing.T) {
	b := armarBot(t)
	ctx := b.ctx
	b.wa.ConBuscador(
		func(context.Context, string, string) ([]ProductoBot, error) {
			return []ProductoBot{{Nombre: "Melamina Blanca", Slug: "melamina-blanca", Medidas: []string{"1830 x 2600mm — 18mm"}}}, nil
		},
		func(context.Context, string) (*FichaBot, error) {
			return &FichaBot{Nombre: "Melamina Blanca", Unidad: "placa", Variantes: []VarianteBot{
				{Label: "1830 x 2600mm — 18mm", EspesorMm: 18, Precio: "52000.50"},
			}}, nil
		})
	// La respuesta del bot no se puede guardar mientras esté el ajuste.
	if _, err := b.pool.Exec(ctx, `
		create function prueba_falla() returns trigger language plpgsql as $$
		begin
			if new.origen = 'bot' and exists (select 1 from site_settings where clave = 'prueba_falla') then
				raise exception 'la base se cayó';
			end if;
			return new;
		end $$;
		create trigger prueba_falla before insert on whatsapp_mensajes for each row execute function prueba_falla();
		insert into site_settings (clave, valor) values ('prueba_falla', 'si');`); err != nil {
		t.Fatal(err)
	}
	jid := "5492235550201"
	b.texto(jid, "cuánto salen 10 placas de melamina blanca?")
	presupuestos := func() int {
		var n int
		_ = b.pool.QueryRow(ctx, `select count(*)::int from quotes where contacto_telefono = '+5492235550201'`).Scan(&n)
		return n
	}
	var sinVer int
	_ = b.pool.QueryRow(ctx, `select count(*)::int from whatsapp_mensajes where conversacion_id = $1 and direccion = 'entrante'
		and coalesce(datos->>'bot', '') = ''`, b.conv(jid)).Scan(&sinVer)
	if r := b.delBot(jid); len(r) != 0 || presupuestos() != 1 || sinVer != 1 {
		t.Fatalf("con la base caída: %q, %d presupuestos, %d sin ver", r, presupuestos(), sinVer)
	}

	// Vuelve la base: el reintento de la cola contesta, sin otro presupuesto.
	if _, err := b.pool.Exec(ctx, `delete from site_settings where clave = 'prueba_falla'`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := b.wa.atenderTurno(ctx, b.conv(jid), jid); err != nil {
			t.Fatal(err)
		}
	}
	r := b.delBot(jid)
	if len(r) != 1 || !strings.Contains(r[0], "te armo el presupuesto") || presupuestos() != 1 {
		t.Errorf("después del reintento: %q, %d presupuestos", r, presupuestos())
	}
}

// Un audio que no se transcribe nunca (el proceso se reinició a mitad) no
// deja sin respuesta lo demás: el turno vuelve cuando el audio se da por
// perdido, y contesta todo junto.
func TestBotNoEsperaPorSiempreUnAudio(t *testing.T) {
	b := armarBot(t)
	ctx := b.ctx
	b.wa.rafaga = 300 * time.Millisecond
	jid := "5492235550211"
	conv, err := b.wa.ConversacionDe(ctx, jid, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	var audio string
	if err := b.pool.QueryRow(ctx, `insert into whatsapp_mensajes (conversacion_id, direccion, tipo, cuerpo, ocurrido_at, media_estado)
		values ($1, 'entrante', 'audio', '', now(), 'listo') returning id`, conv.ID).Scan(&audio); err != nil {
		t.Fatal(err)
	}
	b.texto(jid, "a qué hora abren?")
	time.Sleep(400 * time.Millisecond)
	b.procesar(t)
	if r := b.delBot(jid); len(r) != 0 {
		t.Fatalf("contestó sin esperar al audio: %q", r)
	}
	var enSeis int
	_ = b.pool.QueryRow(ctx, `select count(*)::int from trabajos where tipo = $1 and estado = 'pendiente'
		and proximo_intento_at > now() + interval '5 minutes'`, TrabajoTurno).Scan(&enSeis)
	if enSeis != 1 {
		t.Fatalf("el turno tendría que volver cuando el audio se da por perdido: %d", enSeis)
	}

	// Pasan los seis minutos y la transcripción no llegó.
	if _, err := b.pool.Exec(ctx, `update whatsapp_mensajes set created_at = now() - interval '7 minutes' where id = $1`, audio); err != nil {
		t.Fatal(err)
	}
	if _, err := b.pool.Exec(ctx, `update trabajos set proximo_intento_at = now() where tipo = $1 and estado = 'pendiente'`, TrabajoTurno); err != nil {
		t.Fatal(err)
	}
	b.procesar(t)
	r := b.delBot(jid)
	if len(r) != 1 || !strings.Contains(r[0], "Casa Central") || !strings.Contains(r[0], textoSinAudio) {
		t.Fatalf("una respuesta con el horario y el «no pude escucharlo»: %q", r)
	}
	if got := b.uno(t, `select datos->>'audio' from whatsapp_mensajes where id = $1`, audio); got != "fallido" {
		t.Errorf("el audio tendría que quedar como no escuchado: %q", got)
	}
}

// La descarga de un audio que falla en el último reintento de la cola: el bot
// pide que lo escriban.
func TestBotAudioQueNoBaja(t *testing.T) {
	b := armarBot(t)
	ctx := b.ctx
	jid := "5492235550212"
	// La demostración nunca entrega el archivo: el primer intento queda
	// pendiente, para la cola.
	b.entra(jid, MensajeMeta{Tipo: "audio", Media: &MediaMeta{ID: "media-audio-1", Tipo: "audio", Voz: true}})
	if r := b.delBot(jid); len(r) != 0 {
		t.Fatalf("contestó antes de saber si el audio baja: %q", r)
	}
	id := b.uno(t, `select m.id::text from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
		where c.wa_jid = $1 and m.tipo = 'audio'`, jid)
	if estado, err := b.wa.DescargarMedio(ctx, id, 3); err != nil || estado != "fallido" {
		t.Fatalf("último intento: %s %v", estado, err)
	}
	if r := b.delBot(jid); len(r) != 1 || !strings.Contains(r[0], textoSinAudio) {
		t.Errorf("el bot tendría que pedir que lo escriban: %q", r)
	}
}

// Meta rechaza la respuesta del bot sin vuelta: la conversación pasa a una
// persona, que se entera por un aviso.
func TestBotRechazadoPasaAPersona(t *testing.T) {
	b := armarBot(t)
	b.conAvisos()
	b.wa.ConProveedor(&proveedorConError{Demo: &Demo{}, codigo: 131026})
	jid := "5492235550221"
	b.texto(jid, "a qué hora abren?")
	if b.estado(jid) != "derivada" || b.avisos(tituloNoSalio) != 1 {
		t.Errorf("rechazado: estado %s, %d avisos", b.estado(jid), b.avisos(tituloNoSalio))
	}
	var reenvios int
	_ = b.pool.QueryRow(b.ctx, `select count(*)::int from trabajos where tipo = $1`, TrabajoReenvio).Scan(&reenvios)
	if reenvios != 0 {
		t.Errorf("un rechazo no se reintenta: %d", reenvios)
	}
}

// Los reintentos agotados, y el tope alcanzado entre un reintento y otro:
// pasa a una persona, sin mandar nada más.
func TestBotReintentosAgotadosPasaAPersona(t *testing.T) {
	b := armarBot(t)
	ctx := b.ctx
	b.conAvisos()
	p := &proveedorQueFalla{Demo: &Demo{}, fallas: 100}
	b.wa.ConProveedor(p)
	jid := "5492235550222"
	b.texto(jid, "aceptan transferencia?")
	id := b.uno(t, `select m.id::text from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
		where c.wa_jid = $1 and m.origen = 'bot'`, jid)
	for i := 1; i <= MaxReenvios; i++ {
		if b.estado(jid) == "derivada" {
			t.Fatalf("derivada antes de agotar los reintentos (intento %d)", i)
		}
		if err := b.wa.reenviar(ctx, cargaReenvio{id, i}); err != nil {
			t.Fatal(err)
		}
	}
	if b.estado(jid) != "derivada" || b.avisos(tituloNoSalio) != 1 {
		t.Errorf("agotados: estado %s, %d avisos", b.estado(jid), b.avisos(tituloNoSalio))
	}

	// El tope: el reintento no manda, y pasa a una persona.
	p.fallas = 1
	jid = "5492235550223"
	b.texto(jid, "aceptan transferencia?")
	id = b.uno(t, `select m.id::text from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
		where c.wa_jid = $1 and m.origen = 'bot'`, jid)
	if _, err := b.pool.Exec(ctx, `update site_settings set valor = '0' where clave = 'whatsapp_tope_mensajes'`); err != nil {
		t.Fatal(err)
	}
	if err := b.wa.reenviar(ctx, cargaReenvio{id, 1}); err != nil {
		t.Fatal(err)
	}
	if p.enviados != 0 || b.estado(jid) != "derivada" || b.avisos(tituloNoSalio) != 2 {
		t.Errorf("tope: %d enviados, estado %s, %d avisos", p.enviados, b.estado(jid), b.avisos(tituloNoSalio))
	}
}

// Meta no contestó: puede haberlo mandado igual. No se reintenta solo (sería
// el mensaje repetido); queda para una persona.
func TestBotNoReintentaLoQueQuedoEnDuda(t *testing.T) {
	b := armarBot(t)
	b.conAvisos()
	b.wa.ConProveedor(&proveedorConError{Demo: &Demo{}, incierto: true})
	jid := "5492235550231"
	b.texto(jid, "a qué hora abren?")
	var reenvios int
	_ = b.pool.QueryRow(b.ctx, `select count(*)::int from trabajos where tipo = $1`, TrabajoReenvio).Scan(&reenvios)
	if reenvios != 0 || b.estado(jid) != "derivada" || b.avisos(tituloNoSalio) != 1 {
		t.Errorf("en duda: %d reintentos, estado %s, %d avisos", reenvios, b.estado(jid), b.avisos(tituloNoSalio))
	}
}

// Qué errores de la Graph API dejan la duda: un corte después de mandar el
// pedido sí; no poder conectarse, no.
func TestErrorEnDuda(t *testing.T) {
	corta := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			_ = c.Close()
		}
	}))
	defer corta.Close()
	cfg := Config{PhoneNumberID: "1", AccessToken: "x", GraphURL: corta.URL}
	if _, e := NuevoCloud(cfg).Enviar(context.Background(), "5492235550000", Saliente{Tipo: "texto", Cuerpo: "hola"}); e == nil || !e.Incierto {
		t.Errorf("conexión cortada después del pedido: %+v", e)
	}

	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	cerrado := "http://" + l.Addr().String()
	_ = l.Close()
	cfg.GraphURL = cerrado
	if _, e := NuevoCloud(cfg).Enviar(context.Background(), "5492235550000", Saliente{Tipo: "texto", Cuerpo: "hola"}); e == nil || e.Incierto || e.Accion != AccionReintentar {
		t.Errorf("sin conexión, no salió seguro y se reintenta: %+v", e)
	}
}

// El aviso de cerrado tampoco sale con el tope en dólares.
func TestBotCerradoConTopeEnDolares(t *testing.T) {
	b := armarBot(t)
	ctx := b.ctx
	b.wa.ahora = func() time.Time { return mustTime("2026-11-17T20:00:00-03:00") }
	if _, err := b.pool.Exec(ctx, `insert into whatsapp_sesion (tope_mensual_usd) values (0)`); err != nil {
		t.Fatal(err)
	}
	jid := "5492235550241"
	conv, _ := b.wa.ConversacionDe(ctx, jid, nil, nil)
	if _, err := b.pool.Exec(ctx, `update whatsapp_conversaciones set bot_estado = 'derivada' where id = $1`, conv.ID); err != nil {
		t.Fatal(err)
	}
	ahora := float64(time.Now().UnixMilli())
	b.entra(jid, MensajeMeta{Texto: "tienen mdf de 18?", Ocurrido: &ahora})
	if r := b.delBot(jid); len(r) != 0 {
		t.Errorf("con el tope en dólares no se avisa: %q", r)
	}
}

// Con 9 de 10, cinco envíos a la vez: sale uno solo.
func TestTopeConEnviosALaVez(t *testing.T) {
	b := armarBot(t)
	ctx := b.ctx
	if _, err := b.pool.Exec(ctx, `update site_settings set valor = '10' where clave = 'whatsapp_tope_mensajes'`); err != nil {
		t.Fatal(err)
	}
	p := &proveedorLento{Demo: &Demo{}}
	b.wa.ConProveedor(p)
	conv, err := b.wa.ConversacionDe(ctx, "5492235550250", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.pool.Exec(ctx, `insert into whatsapp_mensajes (conversacion_id, direccion, tipo, cuerpo, estado, origen, ocurrido_at)
		select $1, 'saliente', 'text', 'x', 'enviado', 'panel', now() - interval '13 hours' from generate_series(1, 9)`, conv.ID); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var topes atomic.Int32
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := b.wa.EnviarYRegistrar(ctx, Envio{ConversacionID: conv.ID, WaJid: conv.WaJid, Mensaje: Saliente{Tipo: "texto", Cuerpo: "hola"},
				Registro: Registro{Cuerpo: "hola"}, Origen: "bot"})
			if err != nil {
				t.Error(err)
				return
			}
			if r.Error != nil && r.Error.Accion == AccionTope {
				topes.Add(1)
			}
		}()
	}
	wg.Wait()
	if p.enviados.Load() != 1 || topes.Load() != 4 {
		t.Errorf("con un lugar: %d enviados, %d frenados por el tope", p.enviados.Load(), topes.Load())
	}
}

// El reintento de la cola y el de la bandeja sobre la misma fila fallida, a
// la vez: sale una vez.
func TestReintentosALaVezNoDuplican(t *testing.T) {
	b := armarBot(t)
	ctx := b.ctx
	b.wa.ConProveedor(&proveedorQueFalla{Demo: &Demo{}, fallas: 1})
	jid := "5492235550260"
	b.texto(jid, "a qué hora abren?")
	id := b.uno(t, `select m.id::text from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
		where c.wa_jid = $1 and m.origen = 'bot' and m.estado = 'fallido'`, jid)
	p := &proveedorLento{Demo: &Demo{}}
	b.wa.ConProveedor(p)
	conv := b.conv(jid)
	var wg sync.WaitGroup
	for i := range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var err error
			if i%2 == 0 {
				err = b.wa.reenviar(ctx, cargaReenvio{id, 1})
			} else {
				// Lo que hace ReintentarMensaje desde la bandeja.
				_, err = b.wa.EnviarYRegistrar(ctx, Envio{ConversacionID: conv, WaJid: jid, Mensaje: Saliente{Tipo: "texto", Cuerpo: "x"},
					Registro: Registro{Cuerpo: "x"}, Origen: "panel", ReintentoDe: &id, ConfirmarTope: true})
			}
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if p.enviados.Load() != 1 {
		t.Errorf("la misma fila salió %d veces", p.enviados.Load())
	}
	if got := b.uno(t, `select estado::text from whatsapp_mensajes where id = $1`, id); got != "enviado" {
		t.Errorf("estado: %s", got)
	}
}

// proveedorConError siempre falla: con un código de Meta, o sin respuesta.
type proveedorConError struct {
	*Demo
	codigo   float64
	incierto bool
}

func (p *proveedorConError) Enviar(context.Context, string, Saliente) (string, *ErrorDeEnvio) {
	if p.incierto {
		return "", errorDeEnvio(&errorGraph{mensaje: "Meta no respondió a tiempo.", incierto: true})
	}
	c := p.codigo
	e := ExplicarError(&c, "")
	return "", &ErrorDeEnvio{Codigo: e.Codigo, Texto: e.Texto, Accion: e.Accion}
}

// proveedorLento tarda en mandar: los envíos a la vez se pisan de verdad.
type proveedorLento struct {
	*Demo
	enviados atomic.Int32
}

func (p *proveedorLento) Enviar(ctx context.Context, destino string, m Saliente) (string, *ErrorDeEnvio) {
	time.Sleep(100 * time.Millisecond)
	p.enviados.Add(1)
	return p.Demo.Enviar(ctx, destino, m)
}
