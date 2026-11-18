package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/asistente"
	"mjbj/internal/cola"
	"mjbj/internal/push"
)

// El turno del bot (18/11/2026, Nahuel: «minimizar la cantidad de mensajes
// que se envían»). La gente escribe en ráfagas —«hola» / «tenés fenólico?» /
// «de 18»— y contestar cada uno es pagar tres mensajes por una respuesta. El
// bot espera unos segundos sin mensajes nuevos y contesta una sola vez,
// todo junto.
//
// Cada entrante pide un turno a la cola para dentro de EsperaRafaga. Cuando
// corre, si llegó algo más nuevo, se corre para después; si no, toma todos los
// entrantes que el bot no vio (marcándolos, así un reintento de la cola no
// contesta dos veces) y arma una respuesta. Un candado por conversación evita
// que dos turnos —el de la cola y el de un audio recién transcripto— se
// repartan los mensajes y contesten dos veces.

// TrabajoTurno contesta lo que juntó una conversación.
const TrabajoTurno = "whatsapp.turno"

// TrabajoReenvio vuelve a mandar una respuesta del bot que no salió.
const TrabajoReenvio = "whatsapp.reenvio"

// EsperaRafaga es cuánto espera el bot sin mensajes nuevos para contestar.
// Ocho segundos: lo que se tarda en escribir la segunda línea; el cliente
// igual tiene la respuesta antes de dejar el teléfono.
const EsperaRafaga = 8 * time.Second

// MaxReenvios son los reintentos de una respuesta que Meta no tomó por un
// problema pasajero (límite por segundo, caída). Después la ve una persona.
const MaxReenvios = 3

const (
	textoArchivo      = "Lo recibimos: lo mira una persona del mostrador y te contesta por acá."
	textoNoVisible    = "No pude ver ese mensaje. ¿Me lo escribís?"
	textoCerrado      = "Ahora estamos cerrados: te contestamos %s."
	ventanaRepeticion = 12 * time.Hour
	// esperaAudio es cuánto se espera a que un audio tenga texto: el plazo
	// de su transcripción (lanzarAudio). Pasado eso, se da por perdido.
	esperaAudio = 6 * time.Minute
)

type cargaTurno struct {
	ConversacionID string `json:"conversacionId"`
	WaJid          string `json:"waJid"`
}

type cargaReenvio struct {
	MensajeID string `json:"mensajeId"`
	Intento   int    `json:"intento"`
}

// ConEsperaRafaga cambia la espera (las pruebas la ponen en cero: el turno
// corre en el momento).
func (s *Servicio) ConEsperaRafaga(d time.Duration) *Servicio { s.rafaga = d; return s }

// botAtiende son los tipos de entrante que piden turno. Un sticker, una
// reacción o un aviso del sistema no: no son una consulta, y contestarlos es
// pagar por nada.
func botAtiende(tipo string) bool {
	switch tipo {
	case "audio", "sticker", "reaction", "system", "media_placeholder":
		return false
	}
	return true
}

// Lo que es cada entrante para el bot.
type claseEntrante int

const (
	entranteIgnorar claseEntrante = iota
	entranteTexto
	// entranteArchivo: una foto, un video o un documento sin texto, una
	// ubicación, un contacto, un pedido del catálogo. Lo tiene que mirar
	// alguien: pasa a una persona por este mismo número.
	entranteArchivo
	entranteAudioSinTexto
	// entranteNoVisible: un tipo que WhatsApp no deja ver por la API.
	entranteNoVisible
)

// clasificarEntrante dice qué es un entrante y qué texto tiene. conArchivo:
// además del texto (el epígrafe de una foto) hay algo que mirar.
func clasificarEntrante(tipo, cuerpo string, transcripcion *string, audioFallido bool) (clase claseEntrante, texto string, conArchivo bool) {
	cuerpo = trimJS(cuerpo)
	switch tipo {
	case "audio":
		if transcripcion != nil && trimJS(*transcripcion) != "" {
			return entranteTexto, *transcripcion, false
		}
		if audioFallido || transcripcion != nil {
			return entranteAudioSinTexto, "", false
		}
		return entranteIgnorar, "", false
	case "text", "button", "interactive":
		if cuerpo == "" {
			return entranteIgnorar, "", false
		}
		return entranteTexto, cuerpo, false
	case "image", "video", "document":
		if cuerpo == "" {
			return entranteArchivo, "", false
		}
		return entranteTexto, cuerpo, true
	case "location", "contacts", "order":
		return entranteArchivo, "", false
	case "sticker", "reaction", "system", "media_placeholder":
		return entranteIgnorar, "", false
	}
	return entranteNoVisible, "", false
}

// pedirTurno deja el turno para dentro de EsperaRafaga. Con el bot apagado no
// encola nada: la cola no se llena de turnos que no van a contestar.
func (s *Servicio) pedirTurno(ctx context.Context, convID, waJid string) error {
	if s.rafaga <= 0 {
		return s.atenderTurno(ctx, convID, waJid)
	}
	aj, err := s.ajustesBot(ctx)
	if err != nil || !aj.encendido {
		return err
	}
	_, err = cola.Encolar(ctx, s.q, TrabajoTurno, cargaTurno{convID, waJid}, s.ahora().Add(s.rafaga))
	return err
}

// candadoDelBot es un candado de sesión por conversación, en una conexión
// propia: dura todo el turno, que manda mensajes y no cabe en una
// transacción.
func (s *Servicio) candadoDelBot(ctx context.Context, convID string) (func(), error) {
	c, err := s.pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := c.Exec(ctx, `select pg_advisory_lock(hashtextextended('whatsapp-bot:' || $1, 0))`, convID); err != nil {
		c.Release()
		return nil, err
	}
	return func() {
		_, _ = c.Exec(context.WithoutCancel(ctx), `select pg_advisory_unlock(hashtextextended('whatsapp-bot:' || $1, 0))`, convID)
		c.Release()
	}, nil
}

// entranteDelTurno es un mensaje que el bot tomó para contestar.
type entranteDelTurno struct {
	id, tipo, cuerpo string
	transcripcion    *string
	audioFallido     bool
	ocurrido         time.Time
}

// atenderTurno contesta, en un solo mensaje, todo lo que la conversación
// mandó y el bot no vio.
func (s *Servicio) atenderTurno(ctx context.Context, convID, waJid string) error {
	soltar, err := s.candadoDelBot(ctx, convID)
	if err != nil {
		return err
	}
	defer soltar()

	if s.rafaga > 0 {
		// ¿Sigue escribiendo? Lo último que llegó todavía no cumplió la
		// espera: el turno se corre. ¿Hay un audio transcribiéndose? Lo
		// contesta su turno, cuando termine; y si no termina nunca (la
		// descarga o whisper fallaron sin avisar, el proceso se reinició a
		// mitad), este mismo turno vuelve cuando el audio se da por perdido:
		// lo demás que mandó no puede quedar sin respuesta.
		var falta, faltaAudio float64
		if err := s.pool.QueryRow(ctx, `
			select coalesce(extract(epoch from max(created_at) + make_interval(secs => $2) - now()), 0)::float8,
				coalesce(extract(epoch from max(created_at) filter (where tipo = 'audio' and datos->>'transcripcion' is null
					and coalesce(datos->>'audio', '') <> 'fallido') + make_interval(secs => $3) - now()), 0)::float8
			  from whatsapp_mensajes where conversacion_id = $1 and direccion = 'entrante' and coalesce(datos->>'bot', '') = ''`,
			convID, s.rafaga.Seconds(), esperaAudio.Seconds()).Scan(&falta, &faltaAudio); err != nil {
			return err
		}
		if faltaAudio > 0 {
			_, err := cola.Encolar(ctx, s.q, TrabajoTurno, cargaTurno{convID, waJid},
				s.ahora().Add(time.Duration(faltaAudio*float64(time.Second))+time.Second))
			return err
		}
		if falta > 0 {
			_, err := cola.Encolar(ctx, s.q, TrabajoTurno, cargaTurno{convID, waJid},
				s.ahora().Add(time.Duration(falta*float64(time.Second))+500*time.Millisecond))
			return err
		}
	}

	est, motivo, err := s.botPuedeHablar(ctx, convID)
	if err != nil {
		return err
	}
	if est == nil {
		if motivo == callaPersona {
			return s.avisarCerrado(ctx, convID, waJid)
		}
		return nil
	}
	entrantes, err := s.tomarEntrantes(ctx, convID)
	if err != nil || len(entrantes) == 0 {
		return err
	}
	intentado, err := s.contestarTurno(ctx, convID, waJid, est, entrantes)
	if err != nil && !intentado {
		// No salió nada: los mensajes vuelven a quedar sin ver, y el reintento
		// de la cola los contesta. Si ni eso se puede (la base no anda), que
		// lo sepa una persona; si la cola agota los intentos, también avisa.
		if e := s.devolverEntrantes(ctx, entrantes); e != nil {
			s.log.Error("whatsapp: no se pudieron devolver los mensajes al bot", "error", e, "conversacion", convID)
			s.avisar(ctx, push.Aviso{Titulo: "WhatsApp: el bot no pudo contestar", Cuerpo: "Falló la base al armar la respuesta. Contestale vos.",
				URL: "/admin/whatsapp?chat=" + convID, Etiqueta: "whatsapp-" + convID, Pantalla: "/admin/whatsapp"})
		}
	}
	return err
}

// devolverEntrantes les saca la marca del bot a los mensajes de un turno que
// no llegó a mandar nada.
func (s *Servicio) devolverEntrantes(ctx context.Context, entrantes []entranteDelTurno) error {
	ids := make([]string, len(entrantes))
	for i, e := range entrantes {
		ids[i] = e.id
	}
	_, err := s.pool.Exec(context.WithoutCancel(ctx), `update whatsapp_mensajes set datos = datos - 'bot' where id = any($1::uuid[])`, ids)
	return err
}

// contestarTurno arma la respuesta a los entrantes tomados y la manda.
// intentado: ya se le pidió a Meta; desde ahí, un error no devuelve los
// mensajes (el reintento podría mandar la respuesta dos veces).
func (s *Servicio) contestarTurno(ctx context.Context, convID, waJid string, est *estadoParaElBot, entrantes []entranteDelTurno) (intentado bool, err error) {
	uso, err := s.UsoDelMes(ctx, s.ahora())
	if err != nil {
		s.log.Warn("whatsapp: no se pudo contar el uso del mes", "error", err)
	}
	d := DatosBot{Ahora: s.ahora(), Sitio: s.cfg.URLBase, NumeroHumano: est.ajustes.numeroHumano, StockVisible: est.ajustes.stockVisible, Ahorro: uso.Ahorro}
	recientes, err := s.textosRecientesDelBot(ctx, convID)
	if err != nil {
		return false, err
	}

	estado := est.EstadoBot
	var rs []RespuestaBot
	var textos []string
	var avisos []push.Aviso
	pasaAPersona, archivos, sinAudio, noVisible := false, false, false, false
	for _, m := range entrantes {
		clase, texto, conArchivo := clasificarEntrante(m.tipo, m.cuerpo, m.transcripcion, m.audioFallido)
		archivos = archivos || conArchivo
		switch clase {
		case entranteArchivo:
			archivos = true
		case entranteAudioSinTexto:
			sinAudio = true
		case entranteNoVisible:
			noVisible = true
		case entranteTexto:
			if EsPedidoDeBaja(texto) || EsPedidoDeAlta(texto) || esEco(texto, recientes) {
				continue
			}
			p, err := s.resolverTexto(ctx, convID, waJid, m.id, texto, estado, d)
			if err != nil {
				return false, err
			}
			if p.aviso != nil {
				avisos = append(avisos, *p.aviso)
			}
			pasaAPersona = pasaAPersona || p.pasaAPersona
			if p.r.Texto == "" && !p.r.Derivar {
				// Un acuse o un «gracias»: no cambia nada, ni la memoria.
				continue
			}
			textos = append(textos, texto)
			rs = append(rs, p.r)
			estado = p.r.Estado
		}
	}
	var extra []string
	if archivos {
		pasaAPersona = true
		if !d.Ahorro {
			extra = append(extra, textoArchivo)
		}
	}
	if !d.Ahorro {
		if sinAudio {
			extra = append(extra, textoSinAudio)
		}
		if noVisible {
			extra = append(extra, textoNoVisible)
		}
	}
	// Lo que ya se le dijo en las últimas horas no se repite: el mismo
	// horario, la misma lista, el mismo saludo.
	t := JuntarRespuestas(rs, textos, extra, est.EstadoBot, d, recientes)
	partes := t.Partes
	cerrado := !d.Ahora.IsZero() && !abierto(d.Ahora)
	if cerrado && pasaAPersona && !t.Derivar && len(partes) > 0 {
		// Prometimos que contesta una persona: que sepa cuándo.
		if p := proximaApertura(d.Ahora); p != "" {
			partes[len(partes)-1] += "\n\n" + strings.Replace(textoCerrado, "%s", p, 1)
		}
	}
	texto := cortarJS(strings.Join(partes, "\n\n"), 4000)
	derivada := t.Derivar || pasaAPersona

	// noSalio: la respuesta no llegó y no se va a reintentar sola.
	var noSalio *ErrorDeEnvio
	if texto != "" {
		// Primero se manda; el estado se guarda solo si salió (o si sale en
		// un reintento).
		envio, err := s.EnviarYRegistrar(ctx, Envio{ConversacionID: convID, WaJid: waJid, Mensaje: Saliente{Tipo: "texto", Cuerpo: texto},
			Registro: Registro{Cuerpo: texto}, Origen: "bot"})
		if err != nil {
			return envio.Intentado, err
		}
		intentado = true
		if envio.Error != nil {
			s.log.Warn("la respuesta del bot no salió", "conversacion", convID, "error", envio.Error.Texto)
			noSalio = envio.Error
			if reintentable(envio.Error) && envio.MensajeID != "" {
				if err := s.encolarReenvio(ctx, envio.MensajeID, 1); err != nil {
					s.log.Error("whatsapp: no se pudo encolar el reintento", "error", err, "conversacion", convID)
				} else {
					noSalio = nil
				}
			}
		}
	}
	if noSalio != nil {
		// Meta lo rechazó del todo, se llegó al tope o no se sabe si salió:
		// el cliente no tiene respuesta del bot, y la conversación pasa a una
		// persona, que se entera por el aviso.
		derivada = true
	}
	if derivada {
		_, err = s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_estado = 'derivada', bot_derivada_at = now(), bot_fallos = 0, bot_pendiente = null where id = $1`, convID)
	} else {
		var c *string
		if t.Estado.Consulta != "" {
			c = &t.Estado.Consulta
		}
		var p *string
		if t.Estado.Pendiente != nil {
			b, _ := json.Marshal(t.Estado.Pendiente)
			j := string(b)
			p = &j
		}
		_, err = s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_fallos = $2, bot_consulta = $3, bot_pendiente = $4::jsonb where id = $1`, convID, t.Estado.Fallos, c, p)
	}
	if err != nil {
		return intentado, err
	}
	if cerrado && derivada && texto != "" && noSalio == nil {
		// Ya sabe que estamos cerrados: el aviso de cerrado no se repite.
		if a, _ := aperturaSiguiente(d.Ahora); !a.IsZero() {
			if _, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_cerrado_hasta = $2 where id = $1`, convID, a); err != nil {
				return intentado, err
			}
		}
	}
	for _, a := range avisos {
		s.avisar(ctx, a)
	}
	switch {
	case noSalio != nil:
		s.avisar(ctx, avisoNoSalio(convID, noSalio))
	case derivada:
		cuerpo := cortarJS(strings.Join(textos, " · "), 140)
		if cuerpo == "" {
			cuerpo = "Mandó un archivo para que lo mire alguien."
		}
		s.avisar(ctx, push.Aviso{Titulo: "WhatsApp: pasa a una persona", Cuerpo: cuerpo,
			URL: "/admin/whatsapp?chat=" + convID, Etiqueta: "whatsapp-" + convID, Pantalla: "/admin/whatsapp"})
	}
	return intentado, nil
}

// reintentable: un problema pasajero de Meta, con la seguridad de que no
// salió. Lo que quedó en duda (Incierto) no se reintenta solo.
func reintentable(e *ErrorDeEnvio) bool {
	return e.Accion == AccionReintentar && !e.Incierto
}

// avisoNoSalio es el aviso al personal de una respuesta del bot que no
// llegó: el cliente escribió y nadie le contestó.
func avisoNoSalio(convID string, e *ErrorDeEnvio) push.Aviso {
	return push.Aviso{Titulo: "WhatsApp: el bot no pudo contestar", Cuerpo: cortarJS("Pasa a una persona. "+e.Texto, 200),
		URL: "/admin/whatsapp?chat=" + convID, Etiqueta: "whatsapp-" + convID, Pantalla: "/admin/whatsapp"}
}

// botNoPudoContestar deriva la conversación y avisa: una respuesta del bot
// que no salió y ya no se reintenta (rechazo, reintentos agotados, tope).
func (s *Servicio) botNoPudoContestar(ctx context.Context, convID string, e *ErrorDeEnvio) error {
	if _, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set bot_estado = 'derivada', bot_derivada_at = now(), bot_fallos = 0, bot_pendiente = null where id = $1`, convID); err != nil {
		return err
	}
	s.avisar(ctx, avisoNoSalio(convID, e))
	return nil
}

// tomarEntrantes marca y devuelve lo que el bot no vio: de la última hora
// (un mensaje viejo es Meta reintentando tarde), posterior a lo último que
// escribió una persona (lo anterior ya lo atendió ella) y sin los audios que
// todavía se están transcribiendo o bajando. Un audio que pasó esperaAudio
// sin texto y sin descarga en curso se da por perdido: entra como «no pude
// escucharlo», y no queda afuera para siempre.
func (s *Servicio) tomarEntrantes(ctx context.Context, convID string) ([]entranteDelTurno, error) {
	filas, err := s.pool.Query(ctx, `
		update whatsapp_mensajes m set datos = coalesce(m.datos, '{}'::jsonb) || '{"bot": true}'::jsonb
		       || case when m.tipo = 'audio' and m.datos->>'transcripcion' is null then '{"audio": "fallido"}'::jsonb else '{}'::jsonb end
		 where m.conversacion_id = $1 and m.direccion = 'entrante' and coalesce(m.datos->>'bot', '') = ''
		   and m.ocurrido_at > now() - interval '1 hour'
		   and m.ocurrido_at > coalesce((select max(o.ocurrido_at) from whatsapp_mensajes o where o.conversacion_id = $1
		       and o.direccion = 'saliente' and coalesce(o.origen, '') in ('panel', 'telefono', 'aviso')), '-infinity'::timestamptz)
		   and not (m.tipo = 'audio' and m.datos->>'transcripcion' is null and coalesce(m.datos->>'audio', '') <> 'fallido'
		       and (m.created_at > now() - make_interval(secs => $2) or coalesce(m.media_estado, '') = 'pendiente'))
		returning m.id, m.tipo, coalesce(m.cuerpo, ''), m.datos->>'transcripcion', coalesce(m.datos->>'audio', '') = 'fallido', m.ocurrido_at`,
		convID, esperaAudio.Seconds())
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	var out []entranteDelTurno
	for filas.Next() {
		var e entranteDelTurno
		if err := filas.Scan(&e.id, &e.tipo, &e.cuerpo, &e.transcripcion, &e.audioFallido, &e.ocurrido); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].ocurrido.Equal(out[j].ocurrido) {
			return out[i].ocurrido.Before(out[j].ocurrido)
		}
		return out[i].id < out[j].id
	})
	return out, nil
}

// textosRecientesDelBot son las respuestas del bot de las últimas horas en la
// conversación: lo que ya se dijo y no se repite.
func (s *Servicio) textosRecientesDelBot(ctx context.Context, convID string) ([]string, error) {
	filas, err := s.pool.Query(ctx, `select coalesce(cuerpo, '') from whatsapp_mensajes
		where conversacion_id = $1 and direccion = 'saliente' and origen = 'bot' and estado <> 'fallido'
		  and ocurrido_at > now() - make_interval(secs => $2)`, convID, ventanaRepeticion.Seconds())
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	var out []string
	for filas.Next() {
		var c string
		if err := filas.Scan(&c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, filas.Err()
}

// yaDicho: esa parte ya salió entera en una respuesta reciente.
func yaDicho(parte string, recientes []string) bool {
	for _, r := range recientes {
		if strings.Contains(r, parte) {
			return true
		}
	}
	return false
}

// esEco: el cliente mandó, tal cual, algo que dijo el bot. Es otro bot (o un
// contestador) repitiendo: contestarle es el bucle.
func esEco(texto string, recientes []string) bool {
	t := asistente.Normalizar(texto)
	if len(t) < 12 {
		return false
	}
	for _, r := range recientes {
		if asistente.Normalizar(r) == t {
			return true
		}
	}
	return false
}

// avisarCerrado: la conversación la atiende una persona, y escribió fuera de
// horario. Se le dice una vez cuándo le contestan —una vez por cada vez que
// cerramos—, y no si lo que mandó es un «ok», si una persona le escribió en
// la última hora (está atendiendo) o si el mes está en modo ahorro.
func (s *Servicio) avisarCerrado(ctx context.Context, convID, waJid string) error {
	ahora := s.ahora()
	apertura, _ := aperturaSiguiente(ahora)
	if apertura.IsZero() {
		return nil
	}
	if u, err := s.UsoDelMes(ctx, ahora); err != nil || u.Ahorro {
		return err
	}
	// El tope en dólares también: el aviso es una cortesía, no se paga de más.
	if s.TopeAlcanzado(ctx) {
		return nil
	}
	var textos []string
	var personaHablando bool
	if err := s.pool.QueryRow(ctx, `
		select coalesce(array_agg(coalesce(m.cuerpo, '')) filter (where m.direccion = 'entrante' and coalesce(m.datos->>'bot', '') = ''
				and m.ocurrido_at > now() - interval '1 hour'), '{}'),
			coalesce(bool_or(m.direccion = 'saliente' and coalesce(m.origen, '') in ('panel', 'telefono') and m.ocurrido_at > now() - interval '1 hour'), false)
		  from whatsapp_mensajes m where m.conversacion_id = $1 and m.ocurrido_at > now() - interval '1 hour'`, convID).Scan(&textos, &personaHablando); err != nil {
		return err
	}
	if personaHablando {
		return nil
	}
	consulta := false
	for _, t := range textos {
		t = trimJS(t)
		if t != "" && !esAcuse(t) && !esAutorespuesta(t) && asistente.Entender(t).Intencion != asistente.Gracias &&
			!EsPedidoDeBaja(t) && !EsPedidoDeAlta(t) {
			consulta = true
		}
	}
	if !consulta {
		return nil
	}
	var id string
	err := s.pool.QueryRow(ctx, `update whatsapp_conversaciones set bot_cerrado_hasta = $2
		where id = $1 and (bot_cerrado_hasta is null or bot_cerrado_hasta <= $3) returning id`, convID, apertura, ahora).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	cuerpo := strings.Replace(textoCerrado, "%s", proximaApertura(ahora), 1)
	_, err = s.EnviarYRegistrar(ctx, Envio{ConversacionID: convID, WaJid: waJid, Mensaje: Saliente{Tipo: "texto", Cuerpo: cuerpo},
		Registro: Registro{Cuerpo: cuerpo}, Origen: "bot"})
	return err
}

// encolarReenvio deja el reintento de una respuesta que no salió: 30 s, 1 min,
// 2 min.
func (s *Servicio) encolarReenvio(ctx context.Context, mensajeID string, intento int) error {
	espera := 30 * time.Second * time.Duration(1<<(intento-1))
	_, err := cola.Encolar(ctx, s.q, TrabajoReenvio, cargaReenvio{mensajeID, intento}, s.ahora().Add(espera))
	return err
}

// reenviar vuelve a mandar una respuesta del bot sobre la misma fila (nunca
// otra burbuja): solo si sigue fallida y es de la última hora. Si ya salió
// —la reintentó alguien desde la bandeja—, o la está reintentando, no hace
// nada. Si no sale y no se va a volver a intentar (el tope, un rechazo, los
// reintentos agotados, la duda de si salió), la conversación pasa a una
// persona y se avisa: el cliente escribió y nadie le contestó.
func (s *Servicio) reenviar(ctx context.Context, c cargaReenvio) error {
	var convID, jid, cuerpo string
	var datos []byte
	err := s.pool.QueryRow(ctx, `select m.conversacion_id, c.wa_jid, coalesce(m.cuerpo, ''), m.datos
		from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
		where m.id = $1 and m.direccion = 'saliente' and m.origen = 'bot' and m.estado = 'fallido'
		  and m.created_at > now() - interval '1 hour'`, c.MensajeID).Scan(&convID, &jid, &cuerpo, &datos)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var d struct {
		Envio *Saliente `json:"envio"`
	}
	_ = json.Unmarshal(datos, &d)
	mensaje := Saliente{Tipo: "texto", Cuerpo: cuerpo}
	if d.Envio != nil && d.Envio.Tipo != "" {
		mensaje = *d.Envio
	}
	// El tope lo mira EnviarYRegistrar, con la fila reservada.
	r, err := s.EnviarYRegistrar(ctx, Envio{ConversacionID: convID, WaJid: jid, Mensaje: mensaje, Registro: Registro{Cuerpo: cuerpo},
		Origen: "bot", ReintentoDe: &c.MensajeID})
	if err != nil || r.YaTomado || r.Error == nil {
		return err
	}
	if reintentable(r.Error) && c.Intento < MaxReenvios {
		return s.encolarReenvio(ctx, c.MensajeID, c.Intento+1)
	}
	return s.botNoPudoContestar(ctx, convID, r.Error)
}

// marcarAudioSinTexto deja el audio como «no se pudo escuchar» y pide turno:
// el bot pide que lo escriban, junto con lo demás que haya mandado.
func (s *Servicio) marcarAudioSinTexto(ctx context.Context, mensajeID, convID, waJid string) error {
	if _, err := s.pool.Exec(ctx, `update whatsapp_mensajes set datos = coalesce(datos, '{}'::jsonb) || '{"audio": "fallido"}'::jsonb where id = $1`, mensajeID); err != nil {
		return err
	}
	return s.pedirTurno(ctx, convID, waJid)
}
