package whatsapp

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cola"
	"mjbj/internal/plataforma"
	"mjbj/internal/push"
)

// El webhook de la Cloud API (app/api/whatsapp/webhook y lib/whatsapp/webhook.ts).
// La ruta valida la firma, encola el payload y contesta 200 rápido: Meta
// reintenta si se tarda. El trabajo real —guardar cada evento, bajar los
// adjuntos, avisar al panel— lo hace el worker con la cola.

// Los trabajos de la cola que son de WhatsApp. Las cargas tienen la forma
// del TS (lib/cola/manejadores.ts): la cola la comparten los dos lados.
const (
	TrabajoPayload = "whatsapp.payload"
	TrabajoEstado  = "whatsapp.estado"
	TrabajoMedio   = "whatsapp.medio"
)

type cargaPayload struct {
	Payload json.RawMessage `json:"payload"`
}

type cargaEstado struct {
	Estado  EstadoMeta `json:"estado"`
	Intento int        `json:"intento"`
}

type cargaMedio struct {
	MensajeID string `json:"mensajeId"`
	Intento   int    `json:"intento"`
}

// Registrar suma los trabajos de WhatsApp a la cola del worker.
func (s *Servicio) Registrar(c *cola.Cola) {
	c.Registrar(TrabajoPayload, func(ctx context.Context, crudo json.RawMessage) error {
		var c cargaPayload
		if err := json.Unmarshal(crudo, &c); err != nil {
			return err
		}
		var payload any
		if err := json.Unmarshal(c.Payload, &payload); err != nil {
			return err
		}
		return s.ProcesarPayload(ctx, payload)
	})
	c.Registrar(TrabajoEstado, func(ctx context.Context, crudo json.RawMessage) error {
		var c cargaEstado
		if err := json.Unmarshal(crudo, &c); err != nil {
			return err
		}
		return s.AplicarEstado(ctx, c.Estado, c.Intento)
	})
	c.Registrar(TrabajoMedio, func(ctx context.Context, crudo json.RawMessage) error {
		var c cargaMedio
		if err := json.Unmarshal(crudo, &c); err != nil {
			return err
		}
		_, err := s.DescargarMedio(ctx, c.MensajeID, c.Intento)
		return err
	})
}

// ProcesarPayload procesa un payload ya verificado. Si algo falla, la cola
// reintenta el payload entero, y por la idempotencia no se duplica nada.
func (s *Servicio) ProcesarPayload(ctx context.Context, payload any) error {
	eventos := LeerPayload(payload)
	if err := s.RegistrarSenal(ctx, true); err != nil {
		return err
	}
	huboCobro := false
	for _, e := range eventos {
		// El número tiene que ser el nuestro.
		if e.TieneNumero() && s.cfg.HayCloud() && !vacio(e.PhoneNumberID) && *e.PhoneNumberID != s.cfg.PhoneNumberID {
			s.log.Info("whatsapp: otro número", "phoneNumberId", *e.PhoneNumberID)
			continue
		}
		switch e.Tipo {
		case "estado":
			if err := s.AplicarEstado(ctx, *e.Estado, 0); err != nil {
				return err
			}
			if e.Estado.Cobro != nil && e.Estado.Cobro.Cobrable != nil && *e.Estado.Cobro.Cobrable {
				huboCobro = true
			}
		case "mensaje":
			m := *e.Mensaje
			jid := JidDeBsuid(oTexto(m.UsuarioMeta, ""))
			if m.De != "" {
				jid = JidDeWaId(m.De)
			}
			if _, err := s.AtenderEntrante(ctx, m, jid); err != nil {
				return err
			}
		case "eco":
			// Lo que el personal contestó desde el teléfono: no se cobra, no
			// abre la ventana y no avisa a nadie.
			m := *e.Mensaje
			destino := JidDeBsuid(oTexto(m.ParaUsuario, ""))
			if !vacio(m.Para) {
				destino = JidDeWaId(*m.Para)
			}
			id, err := s.RegistrarEco(ctx, m, destino)
			if err != nil {
				return err
			}
			if id != "" && m.Media != nil {
				if _, err := s.DescargarMedio(ctx, id, 0); err != nil {
					return err
				}
			}
		case "eco-cambio":
			if _, err := s.AplicarCambioDeEco(ctx, e.Cambio, e.Original, e.TextoCambio); err != nil {
				return err
			}
		case "historial":
			n, err := s.ImportarHistorial(ctx, *e.Parte)
			if err != nil {
				return err
			}
			s.log.Info("whatsapp: historial", "fase", e.Parte.Fase, "parte", e.Parte.Orden, "progreso", e.Parte.Progreso, "nuevos", n)
		case "historial-medios":
			ids, err := s.CompletarMediosDelHistorial(ctx, e.Mensajes)
			if err != nil {
				return err
			}
			for _, id := range ids {
				if _, err := s.DescargarMedio(ctx, id, 0); err != nil {
					return err
				}
			}
		case "historial-error":
			// 2593109: el negocio eligió no compartir el historial al conectar.
			s.log.Info("whatsapp: historial_error", "codigo", e.Codigo, "detalle", e.Detalle)
		case "contactos":
			n, err := s.SincronizarContactos(ctx, e.Contactos)
			if err != nil {
				return err
			}
			s.log.Info("whatsapp: contactos", "conNombre", n)
		case "cuenta":
			// Meta corta la coexistencia si el teléfono no abre la app en ~14 días.
			if e.EventoCuenta == "PARTNER_REMOVED" || e.EventoCuenta == "ACCOUNT_OFFBOARDED" {
				cuerpo := "Meta desconectó el número de la plataforma. Revisá la configuración."
				if oTexto(e.Motivo, "") == "PRIMARY_INACTIVITY" {
					cuerpo = "El teléfono no abrió la app de WhatsApp Business en dos semanas y Meta cortó la coexistencia. Hay que volver a conectarlo."
				}
				s.avisar(ctx, push.Aviso{Titulo: "Se cortó la conexión de WhatsApp con el teléfono", Cuerpo: cuerpo,
					URL: "/admin/whatsapp/configuracion", Etiqueta: "whatsapp-cuenta", Pantalla: "/admin/whatsapp/configuracion"})
			}
			s.log.Info("whatsapp: cuenta", "evento", e.EventoCuenta, "motivo", e.Motivo)
		case "plantilla":
			if err := s.ActualizarEstadoPlantilla(ctx, e.Nombre, e.Idioma, e.EstadoPlantilla, e.Motivo); err != nil {
				return err
			}
		case "calidad":
			if _, err := s.pool.Exec(ctx, `update whatsapp_sesion set calidad = $1, limite_mensajes = $2, updated_at = now()`, e.EventoCalidad, e.Limite); err != nil {
				return err
			}
			if ev := oTexto(e.EventoCalidad, ""); ev == "DOWNGRADE" || ev == "FLAGGED" {
				s.avisar(ctx, push.Aviso{Titulo: "Bajó la calidad del número de WhatsApp",
					Cuerpo: "Hay clientes marcando los mensajes como no deseados. Revisá los avisos automáticos.",
					URL:    "/admin/whatsapp/configuracion", Etiqueta: "whatsapp-calidad", Pantalla: "/admin/whatsapp/configuracion"})
			}
		case "otro":
			s.log.Info("whatsapp: campo sin manejar", "campo", e.Campo)
		}
	}
	// Meta confirmó un cobro: puede haber pasado el 80 % o el 100 % del tope.
	if huboCobro {
		s.RevisarUmbrales(ctx)
	}
	return nil
}

// AtenderEntrante es lo que pasa cuando escribe un cliente: se guarda, se
// baja el adjunto, se atiende el «BAJA» y se avisa al personal. Lo usan el
// webhook y el simulador de la demostración.
func (s *Servicio) AtenderEntrante(ctx context.Context, m MensajeMeta, waJid string) (string, error) {
	g, err := s.IngresarEntrante(ctx, m, waJid)
	if err != nil || g == nil {
		return "", err
	}
	if g.MediaID != nil {
		if _, err := s.DescargarMedio(ctx, g.MensajeID, 0); err != nil {
			return "", err
		}
	}
	if err := s.atenderBajaOAlta(ctx, g.ConversacionID, waJid, g.Cuerpo); err != nil {
		return "", err
	}
	cuerpo := cortarJS(trimJS(g.Cuerpo), 140)
	if cuerpo == "" {
		cuerpo = "Mandó un archivo."
	}
	a := push.Aviso{Titulo: "WhatsApp de " + g.Nombre, Cuerpo: cuerpo, URL: "/admin/whatsapp?chat=" + g.ConversacionID,
		Etiqueta: "whatsapp-" + g.ConversacionID, Pantalla: "/admin/whatsapp"}
	if g.AsignadoA != nil {
		a.Pantalla, a.Usuario = "", *g.AsignadoA
	}
	s.avisar(ctx, a)
	return g.MensajeID, nil
}

// AplicarEstado aplica un estado. Si el mensaje todavía no está —Meta puede
// avisar «sent» antes de que el envío guarde su id—, se espera un poco y
// después se deja para la cola, hasta tres veces.
func (s *Servicio) AplicarEstado(ctx context.Context, e EstadoMeta, intento int) error {
	aplicado, err := s.ActualizarEstadoMensaje(ctx, e)
	if err != nil {
		return err
	}
	for espera := 0; !aplicado && intento == 0 && espera < 3; espera++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(s.espera):
		}
		if aplicado, err = s.ActualizarEstadoMensaje(ctx, e); err != nil {
			return err
		}
	}
	if aplicado || intento >= 3 {
		return nil
	}
	_, err = cola.Encolar(ctx, s.q, TrabajoEstado, cargaEstado{e, intento + 1}, s.ahora().Add(30*time.Second))
	return err
}

// DescargarMedio baja el adjunto de un mensaje y lo guarda en lo privado.
// Si Meta no lo entrega, el mensaje queda con el aviso y el botón de
// reintentar; hasta tres reintentos automáticos por la cola. Un error al
// bajar o guardar no se devuelve: si se devolviera, la cola reintentaría el
// payload entero y el adjunto no se volvería a intentar nunca.
func (s *Servicio) DescargarMedio(ctx context.Context, mensajeID string, intento int) (string, error) {
	var mediaID, estado, mime *string
	err := s.pool.QueryRow(ctx, `select media_id, media_estado, media_mime from whatsapp_mensajes where id = $1`, mensajeID).Scan(&mediaID, &estado, &mime)
	if errors.Is(err, pgx.ErrNoRows) {
		return "fallido", nil
	}
	if err != nil {
		return "", err
	}
	if vacio(mediaID) {
		return "fallido", nil
	}
	if oTexto(estado, "") == "listo" {
		return "listo", nil
	}
	contenido, mimeBajado, errBajar := s.prov.BajarMedia(ctx, *mediaID)
	var ref string
	var bytes int
	var errGuardar error
	if errBajar == nil && len(contenido) <= TamanoMaximoMedio {
		m := mimeBajado
		if m == "" {
			m = oTexto(mime, "")
		}
		ref, bytes, errGuardar = s.GuardarPrivado(contenido, LimpiarMime(m))
	}
	if errBajar != nil || ref == "" {
		motivo := "El archivo es demasiado grande."
		switch {
		case errBajar != nil:
			motivo = errBajar.Error()
		case errGuardar != nil:
			motivo = errGuardar.Error()
		}
		s.log.Info("whatsapp: media no bajada", "mensaje", mensajeID, "motivo", motivo)
		sigue := intento < 3 && (errBajar != nil || errGuardar != nil)
		nuevo := "fallido"
		if sigue {
			nuevo = "pendiente"
		}
		if _, err := s.pool.Exec(ctx, `update whatsapp_mensajes set media_estado = $2, error_detalle = $3 where id = $1`,
			mensajeID, nuevo, cortarJS(motivo, 300)); err != nil {
			return "", err
		}
		if sigue {
			espera := time.Duration(30_000*(1<<intento)) * time.Millisecond
			if _, err := cola.Encolar(ctx, s.q, TrabajoMedio, cargaMedio{mensajeID, intento + 1}, s.ahora().Add(espera)); err != nil {
				return "", err
			}
			return "pendiente", nil
		}
		return "fallido", nil
	}
	m := mimeBajado
	if m == "" {
		m = oTexto(mime, "")
	}
	if _, err := s.pool.Exec(ctx, `update whatsapp_mensajes set media_url = $2, media_mime = $3, media_bytes = $4, media_estado = 'listo',
		error_detalle = null where id = $1`, mensajeID, ref, LimpiarMime(m), bytes); err != nil {
		return "", err
	}
	return "listo", nil
}

const (
	textoBaja = "Listo, no te vamos a mandar más avisos automáticos por WhatsApp. Si nos escribís, te contestamos igual. Si querés volver a recibirlos, escribí ALTA."
	textoAlta = "Listo, vas a volver a recibir los avisos de tus pedidos por WhatsApp."
)

// atenderBajaOAlta: la política de WhatsApp obliga a respetar cualquier
// pedido de no recibir más mensajes. Se registra y se confirma en el momento
// (como acaba de escribir, la ventana está abierta).
func (s *Servicio) atenderBajaOAlta(ctx context.Context, convID, waJid, texto string) error {
	baja := EsPedidoDeBaja(texto)
	alta := !baja && EsPedidoDeAlta(texto)
	if !baja && !alta {
		return nil
	}
	var bajaAt *time.Time
	if err := s.pool.QueryRow(ctx, `select baja_at from whatsapp_conversaciones where id = $1`, convID).Scan(&bajaAt); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if (baja && bajaAt != nil) || (alta && bajaAt == nil) {
		return nil
	}
	var err error
	if baja {
		_, err = s.pool.Exec(ctx, `update whatsapp_conversaciones set baja_at = now(), baja_detalle = $2 where id = $1`,
			convID, "Escribió «"+cortarJS(trimJS(texto), 80)+"»")
	} else {
		_, err = s.pool.Exec(ctx, `update whatsapp_conversaciones set baja_at = null, baja_detalle = null where id = $1`, convID)
	}
	if err != nil {
		return err
	}
	cuerpo := textoAlta
	if baja {
		cuerpo = textoBaja
	}
	_, err = s.EnviarYRegistrar(ctx, Envio{ConversacionID: convID, WaJid: waJid, Mensaje: Saliente{Tipo: "texto", Cuerpo: cuerpo},
		Registro: Registro{Cuerpo: cuerpo}, Origen: "sistema"})
	return err
}

// --- las rutas (la URL que le dimos a Meta no cambia) ---

// maximoWebhook: el tope de Meta para un payload es 3 MB.
const maximoWebhook = 4 * 1024 * 1024

// VerificarWebhook es el GET con que Meta da de alta la URL.
func (s *Servicio) VerificarWebhook(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	secreto := s.cfg.WebhookSecret
	if secreto != "" && q.Get("hub.mode") == "subscribe" &&
		subtle.ConstantTimeCompare([]byte(q.Get("hub.verify_token")), []byte(secreto)) == 1 {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(q.Get("hub.challenge")))
		return
	}
	plataforma.EscribirJSON(w, http.StatusForbidden, map[string]string{"error": "Verificación inválida."})
}

// RecibirWebhook es el POST de Meta: firma sobre los bytes crudos, a la cola
// antes de contestar, y 200.
func (s *Servicio) RecibirWebhook(w http.ResponseWriter, r *http.Request) {
	crudo, err := io.ReadAll(io.LimitReader(r.Body, maximoWebhook+1))
	if err != nil {
		plataforma.EscribirJSON(w, http.StatusBadRequest, map[string]string{"error": "No llegó el cuerpo."})
		return
	}
	if len(crudo) > maximoWebhook {
		plataforma.EscribirJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Demasiado grande."})
		return
	}
	if !FirmaValida(crudo, r.Header.Get("X-Hub-Signature-256"), s.cfg.AppSecret) {
		plataforma.EscribirJSON(w, http.StatusUnauthorized, map[string]string{"error": "Firma inválida."})
		return
	}
	// 200 igual a lo que no se puede parsear: que Meta no lo reintente.
	if !json.Valid(crudo) {
		plataforma.EscribirJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if _, err := cola.Encolar(r.Context(), s.q, TrabajoPayload, cargaPayload{Payload: crudo}, time.Time{}); err != nil {
		s.log.Error("whatsapp: encolando el webhook", "error", err)
		plataforma.EscribirProblema(w, plataforma.NuevoProblema(http.StatusInternalServerError, "No se pudo guardar el aviso."))
		return
	}
	plataforma.EscribirJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
