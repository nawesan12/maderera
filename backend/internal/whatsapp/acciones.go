package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Las acciones de la bandeja y de la configuración (app/admin/whatsapp/actions.ts
// y configuracion/acciones.ts). Quien llama ya exigió el rol. Devuelven lo que
// devolvía la server action (`EstadoWhatsapp`): los errores que ve quien
// atiende no son errores HTTP.

// Resultado es EstadoWhatsapp (y EstadoAviso) del TS.
type Resultado struct {
	Error                    string `json:"error,omitempty"`
	Ok                       string `json:"ok,omitempty"`
	RequierePlantilla        bool   `json:"requierePlantilla,omitempty"`
	RequiereConfirmacionTope bool   `json:"requiereConfirmacionTope,omitempty"`
	ConversacionID           string `json:"conversacionId,omitempty"`
	MensajeID                string `json:"mensajeId,omitempty"`
}

func conError(t string) Resultado { return Resultado{Error: t} }

func deErrorDeEnvio(e *ErrorDeEnvio) Resultado {
	return Resultado{Error: e.Texto, RequierePlantilla: e.Accion == AccionPlantilla, RequiereConfirmacionTope: e.Accion == AccionTope}
}

// MaxMensaje es el largo máximo de un texto que sale.
const MaxMensaje = 4096

const noEncontrada = "No encontramos esa conversación."

func (s *Servicio) laConversacion(ctx context.Context, id string) (*Conversacion, error) {
	if !plataforma.UUIDValido(id) {
		return nil, nil
	}
	return s.Conversacion(ctx, id)
}

// Responder contesta con texto libre (dentro de la ventana).
func (s *Servicio) Responder(ctx context.Context, ses *auth.Sesion, convID, cuerpo, citado string, confirmarTope bool) (Resultado, error) {
	cuerpo = trimJS(cuerpo)
	if cuerpo == "" {
		return conError("Escribí algo."), nil
	}
	if largoJS(cuerpo) > MaxMensaje {
		return conError("El mensaje es demasiado largo."), nil
	}
	c, err := s.laConversacion(ctx, convID)
	if err != nil || c == nil {
		return conError(noEncontrada), err
	}
	// Fuera de la ventana ni se intenta: Meta lo rechazaría (131047).
	if !VentanaAbierta(c.UltimoEntranteAt, s.ahora()) {
		return Resultado{Error: "Pasaron más de 24 horas desde su último mensaje: WhatsApp solo deja mandar un mensaje preparado.", RequierePlantilla: true}, nil
	}
	cit := nulo(ptr(trimJS(citado)))
	r, err := s.EnviarYRegistrar(ctx, Envio{ConversacionID: c.ID, WaJid: c.WaJid, Mensaje: Saliente{Tipo: "texto", Cuerpo: cuerpo, Citado: cit},
		Registro: Registro{Cuerpo: cuerpo, Citado: cit}, Origen: "panel", EnviadoPor: &ses.UserID, ConfirmarTope: confirmarTope})
	if err != nil {
		return Resultado{}, err
	}
	if r.Error != nil {
		return deErrorDeEnvio(r.Error), nil
	}
	return Resultado{MensajeID: r.MensajeID}, nil
}

// PDF es un documento de la plataforma que armó Next (los PDF siguen en TS).
type PDF struct {
	Contenido   []byte
	Nombre      string
	Descripcion string
}

func (s *Servicio) subirYGuardar(ctx context.Context, doc PDF) (*MediaRegistro, *ErrorDeEnvio, error) {
	id, e := s.prov.SubirMedia(ctx, doc.Contenido, "application/pdf", doc.Nombre)
	if e != nil || id == "" {
		return nil, e, nil
	}
	ref, n, err := s.GuardarPrivado(doc.Contenido, "application/pdf")
	if err != nil {
		return nil, nil, err
	}
	return &MediaRegistro{Referencia: ref, Tipo: "document", Mime: "application/pdf", Nombre: ptr(doc.Nombre), Bytes: &n, MediaID: &id}, nil, nil
}

// EnviarPlantilla manda una plantilla aprobada. En la base queda el texto
// completado, no solo el nombre.
func (s *Servicio) EnviarPlantilla(ctx context.Context, ses *auth.Sesion, convID, nombre, idioma string, valoresCrudos map[string]string, doc *PDF, confirmarTope bool) (Resultado, error) {
	c, err := s.laConversacion(ctx, convID)
	if err != nil || c == nil {
		return conError(noEncontrada), err
	}
	p, err := s.PlantillaDisponible(ctx, nombre, idioma)
	if err != nil {
		return Resultado{}, err
	}
	if p == nil {
		return conError("Ese mensaje preparado no está aprobado. Elegí otro."), nil
	}
	valores := map[string]string{}
	for _, campo := range p.Campos {
		if v, ok := valoresCrudos[campo.Clave]; ok {
			valores[campo.Clave] = cortarJS(v, 500)
		}
	}
	if len(CamposFaltantes(p.Plantilla, valores)) > 0 {
		return conError("Completá todos los datos del mensaje preparado."), nil
	}
	if !confirmarTope && s.TopeAlcanzado(ctx) {
		return deErrorDeEnvio(&ErrorTope), nil
	}
	var media *MediaRegistro
	medio := oTexto(p.EncabezadoMedia, "")
	switch {
	case medio == "document":
		if doc == nil {
			return conError("Este mensaje lleva un documento: elegí cuál mandar."), nil
		}
		m, e, err := s.subirYGuardar(ctx, *doc)
		if err != nil {
			return Resultado{}, err
		}
		if e != nil || m == nil {
			t := "No se pudo subir el PDF."
			if e != nil {
				t = e.Texto
			}
			return conError(t), nil
		}
		media = m
	case medio != "":
		return conError("Este mensaje lleva una foto o un video en el encabezado, y eso todavía no se manda desde acá."), nil
	}
	var me *MediaEncabezado
	if media != nil {
		me = &MediaEncabezado{ID: *media.MediaID, Nombre: *media.Nombre}
	}
	r, err := s.EnviarYRegistrar(ctx, Envio{ConversacionID: c.ID, WaJid: c.WaJid,
		Mensaje:  Saliente{Tipo: "plantilla", Nombre: p.Nombre, Idioma: p.Idioma, Componentes: ArmarComponentes(p.Plantilla, valores, me)},
		Registro: Registro{Cuerpo: VistaPrevia(p.Plantilla, valores), Plantilla: &p.Nombre, Media: media},
		Origen:   "panel", EnviadoPor: &ses.UserID, ConfirmarTope: confirmarTope})
	if err != nil {
		return Resultado{}, err
	}
	if r.Error != nil {
		return deErrorDeEnvio(r.Error), nil
	}
	return Resultado{Ok: "Mensaje enviado.", MensajeID: r.MensajeID}, nil
}

// TiposDeDocumento son los papeles que se pueden mandar.
var TiposDeDocumento = []string{"presupuesto", "comprobante", "remito", "recibo", "cuenta", "corte"}

// EsTipoDeDocumento dice si es uno de esos.
func EsTipoDeDocumento(t string) bool { return contiene(TiposDeDocumento, t) }

// EnviarDocumento manda un papel de la plataforma: dentro de la ventana
// como documento con epígrafe; fuera, con la plantilla `documento_adjunto`
// (o `presupuesto_enviado`), que lleva el PDF en el encabezado.
func (s *Servicio) EnviarDocumento(ctx context.Context, ses *auth.Sesion, convID, tipo, id, epigrafe string, doc *PDF, confirmarTope bool) (Resultado, error) {
	c, err := s.laConversacion(ctx, convID)
	if err != nil || c == nil {
		return conError(noEncontrada), err
	}
	if !EsTipoDeDocumento(tipo) {
		return conError("Elegí qué documento mandar."), nil
	}
	if !confirmarTope && s.TopeAlcanzado(ctx) {
		return deErrorDeEnvio(&ErrorTope), nil
	}
	if doc == nil {
		return conError("No encontramos ese documento."), nil
	}
	media, e, err := s.subirYGuardar(ctx, *doc)
	if err != nil {
		return Resultado{}, err
	}
	if e != nil || media == nil {
		t := "No se pudo subir el PDF a WhatsApp."
		if e != nil {
			t = e.Texto
		}
		return conError(t), nil
	}
	datos := obj{"documento": obj{"tipo": tipo, "id": id}}
	var mensaje Saliente
	var cuerpo string
	var plantillaUsada *string
	if VentanaAbierta(c.UltimoEntranteAt, s.ahora()) {
		cuerpo = trimJS(epigrafe)
		mensaje = Saliente{Tipo: "media", Clase: "document", Media: &RefMedia{ID: *media.MediaID}, Epigrafe: &cuerpo, NombreArchivo: &doc.Nombre}
	} else {
		nombre := "documento_adjunto"
		if tipo == "presupuesto" {
			nombre = "presupuesto_enviado"
		}
		p, err := s.PlantillaDisponible(ctx, nombre, "")
		if err != nil {
			return Resultado{}, err
		}
		if p == nil {
			if p, err = s.PlantillaDisponible(ctx, "documento_adjunto", ""); err != nil {
				return Resultado{}, err
			}
		}
		if p == nil {
			return Resultado{Error: "Pasaron más de 24 horas y la plantilla «documento_adjunto» todavía no está aprobada en Meta. Mandá primero un mensaje preparado y, cuando conteste, el PDF.",
				RequierePlantilla: true}, nil
		}
		conocidos := map[string]string{"nombre": s.nombreDeLaConversacion(ctx, c), "documento": doc.Descripcion}
		valores := map[string]string{}
		for _, campo := range p.Campos {
			valores[campo.Clave] = conocidos[campo.Marcador]
		}
		if len(CamposFaltantes(p.Plantilla, valores)) > 0 {
			return conError("La plantilla «" + p.Nombre + "» pide datos que no se completan solos. Mandala desde «Mensaje preparado»."), nil
		}
		cuerpo = VistaPrevia(p.Plantilla, valores)
		plantillaUsada = &p.Nombre
		mensaje = Saliente{Tipo: "plantilla", Nombre: p.Nombre, Idioma: p.Idioma,
			Componentes: ArmarComponentes(p.Plantilla, valores, &MediaEncabezado{ID: *media.MediaID, Nombre: doc.Nombre})}
	}
	r, err := s.EnviarYRegistrar(ctx, Envio{ConversacionID: c.ID, WaJid: c.WaJid, Mensaje: mensaje,
		Registro: Registro{Cuerpo: cuerpo, Media: media, Plantilla: plantillaUsada, Datos: datos},
		Origen:   "panel", EnviadoPor: &ses.UserID, ConfirmarTope: true})
	if err != nil {
		return Resultado{}, err
	}
	if r.Error != nil {
		return deErrorDeEnvio(r.Error), nil
	}
	return Resultado{Ok: doc.Nombre + " enviado.", MensajeID: r.MensajeID}, nil
}

func (s *Servicio) nombreDeLaConversacion(ctx context.Context, c *Conversacion) string {
	if c.CustomerID != nil {
		var n string
		if err := s.pool.QueryRow(ctx, `select nombre from customers where id = $1`, *c.CustomerID).Scan(&n); err == nil {
			return primeraPalabraJS(n)
		}
	}
	if p := primeraPalabraJS(oTexto(c.DisplayName, "")); p != "" {
		return p
	}
	return "qué tal"
}

// DocumentoAlCliente es lo que sabe Next del papel que se manda desde su pantalla.
type DocumentoAlCliente struct {
	PDF
	CustomerID *string
	Telefono   *string
	Contacto   *string
}

// EnviarDocumentoAlCliente manda un papel desde su propia pantalla al
// teléfono de la ficha, abriendo o reutilizando la conversación.
func (s *Servicio) EnviarDocumentoAlCliente(ctx context.Context, ses *auth.Sesion, tipo, id, telefono string, epigrafe *string, doc *DocumentoAlCliente, confirmarTope bool) (Resultado, error) {
	if !EsTipoDeDocumento(tipo) {
		return conError("Documento desconocido."), nil
	}
	if doc == nil {
		return conError("No encontramos ese documento."), nil
	}
	tel := trimJS(telefono)
	if tel == "" {
		tel = oTexto(doc.Telefono, "")
	}
	if tel == "" && doc.CustomerID != nil {
		var t *string
		_ = s.pool.QueryRow(ctx, `select telefono from customers where id = $1`, *doc.CustomerID).Scan(&t)
		tel = oTexto(t, "")
	}
	if tel == "" {
		return conError("El cliente no tiene teléfono cargado. Escribilo para mandarlo."), nil
	}
	jid := AJid(tel)
	if jid == "" {
		return conError("«" + tel + "» no parece un número de WhatsApp."), nil
	}
	c, err := s.ConversacionDe(ctx, jid, nulo(doc.Contacto), nil)
	if err != nil {
		return Resultado{}, err
	}
	if doc.CustomerID != nil && c.CustomerID == nil {
		if _, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set customer_id = $2 where id = $1`, c.ID, *doc.CustomerID); err != nil {
			return Resultado{}, err
		}
	}
	ep := "Te mandamos " + doc.Descripcion + "."
	if epigrafe != nil {
		ep = *epigrafe
	}
	r, err := s.EnviarDocumento(ctx, ses, c.ID, tipo, id, ep, &doc.PDF, confirmarTope)
	r.ConversacionID = c.ID
	return r, err
}

// ReintentarMensaje vuelve a mandar un mensaje que no salió, tal cual se había pedido.
func (s *Servicio) ReintentarMensaje(ctx context.Context, ses *auth.Sesion, mensajeID string, confirmarTope bool) (Resultado, error) {
	if !plataforma.UUIDValido(mensajeID) {
		return conError("Mensaje inválido."), nil
	}
	var convID, cuerpo, jid string
	var datos []byte
	c := &Conversacion{}
	err := s.pool.QueryRow(ctx, `select m.conversacion_id, m.cuerpo, m.datos, c.wa_jid, c.ultimo_entrante_at
		from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id
		where m.id = $1 and m.direccion = 'saliente' and m.estado = 'fallido'`, mensajeID).Scan(&convID, &cuerpo, &datos, &jid, &c.UltimoEntranteAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return conError("Ese mensaje ya no está para reintentar."), nil
	}
	if err != nil {
		return Resultado{}, err
	}
	var d struct {
		Envio *Saliente `json:"envio"`
	}
	_ = json.Unmarshal(datos, &d)
	mensaje := Saliente{Tipo: "texto", Cuerpo: cuerpo}
	if d.Envio != nil && d.Envio.Tipo != "" {
		mensaje = *d.Envio
	}
	if mensaje.Tipo != "plantilla" && !VentanaAbierta(c.UltimoEntranteAt, s.ahora()) {
		return Resultado{Error: "Ya pasaron las 24 horas: este mensaje no se puede reintentar. Mandá un mensaje preparado.", RequierePlantilla: true}, nil
	}
	r, err := s.EnviarYRegistrar(ctx, Envio{ConversacionID: convID, WaJid: jid, Mensaje: mensaje, Registro: Registro{Cuerpo: cuerpo},
		Origen: "panel", EnviadoPor: &ses.UserID, ReintentoDe: &mensajeID, ConfirmarTope: confirmarTope})
	if err != nil {
		return Resultado{}, err
	}
	if r.Error != nil {
		return deErrorDeEnvio(r.Error), nil
	}
	return Resultado{Ok: "Enviado."}, nil
}

// Reaccionar pone (o saca) un emoji sobre un mensaje del cliente.
func (s *Servicio) Reaccionar(ctx context.Context, mensajeID, emoji string) (Resultado, error) {
	if !plataforma.UUIDValido(mensajeID) {
		return conError("Mensaje inválido."), nil
	}
	limpio := cortarJS(trimJS(emoji), 16)
	var waID, actual *string
	var jid string
	c := &Conversacion{}
	err := s.pool.QueryRow(ctx, `select m.wa_message_id, c.wa_jid, c.ultimo_entrante_at, m.reaccion_nuestra
		from whatsapp_mensajes m join whatsapp_conversaciones c on c.id = m.conversacion_id where m.id = $1`, mensajeID).
		Scan(&waID, &jid, &c.UltimoEntranteAt, &actual)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Resultado{}, err
	}
	if vacio(waID) {
		return conError("A ese mensaje no se le puede reaccionar."), nil
	}
	if !VentanaAbierta(c.UltimoEntranteAt, s.ahora()) {
		return conError("Pasaron las 24 horas: ya no se puede reaccionar."), nil
	}
	// Tocar el mismo emoji lo saca, como en el teléfono.
	nuevo := limpio
	if actual != nil && *actual == limpio {
		nuevo = ""
	}
	if _, e := s.prov.Enviar(ctx, DestinoDeJid(jid), Saliente{Tipo: "reaccion", AMensaje: *waID, Emoji: &nuevo}); e != nil {
		return conError(e.Texto), nil
	}
	if _, err := s.pool.Exec(ctx, `update whatsapp_mensajes set reaccion_nuestra = $2 where id = $1`, mensajeID, nulo(&nuevo)); err != nil {
		return Resultado{}, err
	}
	return Resultado{}, nil
}

// ReintentarDescarga vuelve a intentar bajar un adjunto que no llegó.
func (s *Servicio) ReintentarDescarga(ctx context.Context, mensajeID string) (Resultado, error) {
	if !plataforma.UUIDValido(mensajeID) {
		return conError("Mensaje inválido."), nil
	}
	// `intento` alto: si vuelve a fallar no se encola otra vez; queda el botón.
	r, err := s.DescargarMedio(ctx, mensajeID, 99)
	if err != nil {
		return Resultado{}, err
	}
	if r == "listo" {
		return Resultado{Ok: "Archivo descargado."}, nil
	}
	return conError("WhatsApp no entregó el archivo. Si pasaron más de 7 días ya no está: pedile que lo reenvíe."), nil
}

// Asignar asigna la conversación a alguien («yo», un id) o la libera ("").
func (s *Servicio) Asignar(ctx context.Context, ses *auth.Sesion, convID, usuarioID string) (Resultado, error) {
	c, err := s.laConversacion(ctx, convID)
	if err != nil || c == nil {
		return conError(noEncontrada), err
	}
	var u *string
	switch usuarioID {
	case "yo":
		u = &ses.UserID
	case "":
	default:
		u = &usuarioID
	}
	if _, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set asignado_a_user_id = $2, updated_at = now() where id = $1`, c.ID, u); err != nil {
		return Resultado{}, err
	}
	if u != nil {
		return Resultado{Ok: "Asignada."}, nil
	}
	return Resultado{Ok: "Quedó sin asignar."}, nil
}

// CambiarEstado marca la conversación como resuelta, o la reabre.
func (s *Servicio) CambiarEstado(ctx context.Context, ses *auth.Sesion, convID, estado string) (Resultado, error) {
	if !plataforma.UUIDValido(convID) || (estado != "abierta" && estado != "cerrada") {
		return conError("No pudimos cambiar el estado."), nil
	}
	resuelta := estado == "cerrada"
	var por *string
	if resuelta {
		por = &ses.UserID
	}
	if _, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set estado = $2::estado_conversacion, no_leidos = 0,
		resuelta_at = case when $3 then now() else null end, resuelta_por_user_id = $4, updated_at = now() where id = $1`,
		convID, estado, resuelta, por); err != nil {
		return Resultado{}, err
	}
	if resuelta {
		return Resultado{Ok: "Conversación resuelta."}, nil
	}
	return Resultado{Ok: "Conversación reabierta."}, nil
}

// ClienteParaVincular es una ficha que coincide con lo que se buscó.
type ClienteParaVincular struct {
	ID       string  `json:"id"`
	Nombre   string  `json:"nombre"`
	Telefono *string `json:"telefono"`
	Cuit     *string `json:"cuit"`
}

// BuscarClientes busca fichas para vincular una conversación sin cliente.
func (s *Servicio) BuscarClientes(ctx context.Context, texto string) ([]ClienteParaVincular, error) {
	termino := cortarJS(trimJS(texto), 60)
	out := []ClienteParaVincular{}
	if largoJS(termino) < 2 {
		return out, nil
	}
	dig := SoloDigitos(termino)
	// Sin escapar % ni _: el TS tampoco lo hacía.
	patron := "%" + termino + "%"
	r, err := s.pool.Query(ctx, `select id, nombre, telefono, cuit from customers
		where active = true and (nombre ilike $1 or razon_social ilike $1
			or ($2 and regexp_replace(coalesce(telefono, '') || ' ' || coalesce(cuit, ''), '\D', '', 'g') like $3))
		limit 8`, patron, len(dig) >= 4, "%"+dig+"%")
	if err != nil {
		return nil, err
	}
	defer r.Close()
	for r.Next() {
		var c ClienteParaVincular
		if err := r.Scan(&c.ID, &c.Nombre, &c.Telefono, &c.Cuit); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, r.Err()
}

// Vincular vincula la conversación con una ficha (o la desvincula).
func (s *Servicio) Vincular(ctx context.Context, convID string, customerID *string) (Resultado, error) {
	if !plataforma.UUIDValido(convID) || (customerID != nil && !plataforma.UUIDValido(*customerID)) {
		return conError("No pudimos vincular el cliente."), nil
	}
	if _, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set customer_id = $2, updated_at = now() where id = $1`, convID, customerID); err != nil {
		return Resultado{}, err
	}
	return Resultado{Ok: "Listo, quedó vinculada."}, nil
}

// CambiarBaja da de baja (o de alta) los avisos de un número desde el panel.
func (s *Servicio) CambiarBaja(ctx context.Context, ses *auth.Sesion, convID string, baja bool) (Resultado, error) {
	c, err := s.laConversacion(ctx, convID)
	if err != nil || c == nil {
		return conError(noEncontrada), err
	}
	if baja {
		_, err = s.pool.Exec(ctx, `update whatsapp_conversaciones set baja_at = now(), baja_detalle = $2 where id = $1`, c.ID, "La cargó "+ses.Nombre+" desde el panel")
	} else {
		_, err = s.pool.Exec(ctx, `update whatsapp_conversaciones set baja_at = null, baja_detalle = null where id = $1`, c.ID)
	}
	if err != nil {
		return Resultado{}, err
	}
	que := "Alta"
	if baja {
		que = "Baja"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "whatsapp", c.ID, que+" de avisos por WhatsApp para "+NumeroLegible(c.WaJid), nil)
	if baja {
		return Resultado{Ok: "No va a recibir más avisos automáticos."}, nil
	}
	return Resultado{Ok: "Vuelve a recibir los avisos."}, nil
}

// AbrirConversacion empieza una conversación con un número que todavía no escribió.
func (s *Servicio) AbrirConversacion(ctx context.Context, telefono string) (Resultado, error) {
	t := trimJS(telefono)
	if largoJS(t) < 6 {
		return conError("Escribí un número válido."), nil
	}
	jid := AJid(t)
	if jid == "" {
		return conError("Ese número no parece válido. Probá con la característica: 223 590-3118."), nil
	}
	c, err := s.ConversacionDe(ctx, jid, nil, nil)
	if err != nil {
		return Resultado{}, err
	}
	return Resultado{Ok: "Conversación abierta.", ConversacionID: c.ID}, nil
}

// SimularEntrante simula que un cliente escribe. Solo en demostración: entra
// por la misma ingesta que el webhook (incluido el «BAJA»).
func (s *Servicio) SimularEntrante(ctx context.Context, convID, cuerpo string) (Resultado, error) {
	if s.prov.ID() != "demo" {
		return conError("Esto solo sirve en modo demostración."), nil
	}
	c, err := s.laConversacion(ctx, convID)
	if err != nil {
		return Resultado{}, err
	}
	cuerpo = trimJS(cuerpo)
	if c == nil || cuerpo == "" || largoJS(cuerpo) > MaxMensaje {
		return conError("Escribí el mensaje a simular."), nil
	}
	ahora := float64(s.ahora().UnixMilli())
	id, err := s.AtenderEntrante(ctx, MensajeMeta{De: WaIdDeJid(c.WaJid), WaMessageID: "demo-in-" + uuid(), Ocurrido: &ahora,
		Tipo: "text", TipoOriginal: "text", Texto: cuerpo}, c.WaJid)
	return Resultado{MensajeID: id}, err
}

// --- la configuración (solo admin) ---

// AvisoGuardado es una fila de whatsapp_avisos.
type AvisoGuardado struct {
	ID         string  `json:"id"`
	Evento     string  `json:"evento"`
	Plantilla  string  `json:"plantilla"`
	Idioma     string  `json:"idioma"`
	TextoLibre *string `json:"textoLibre"`
	Activo     bool    `json:"activo"`
}

// ListarAvisos son los avisos automáticos configurados.
func (s *Servicio) ListarAvisos(ctx context.Context) ([]AvisoGuardado, error) {
	r, err := s.pool.Query(ctx, `select id, evento, plantilla, idioma, texto_libre, activo from whatsapp_avisos order by evento`)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	out := []AvisoGuardado{}
	for r.Next() {
		var a AvisoGuardado
		if err := r.Scan(&a.ID, &a.Evento, &a.Plantilla, &a.Idioma, &a.TextoLibre, &a.Activo); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, r.Err()
}

// CambiarAviso prende o apaga un aviso automático.
func (s *Servicio) CambiarAviso(ctx context.Context, ses *auth.Sesion, id string, activo bool) (Resultado, error) {
	if !plataforma.UUIDValido(id) {
		return conError("No pudimos cambiar el aviso."), nil
	}
	var evento *string
	err := s.pool.QueryRow(ctx, `update whatsapp_avisos set activo = $2, updated_at = now() where id = $1 returning evento`, id, activo).Scan(&evento)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Resultado{}, err
	}
	estado := "apagado"
	if activo {
		estado = "encendido"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "whatsapp", id, "Aviso de WhatsApp «"+oTexto(evento, "undefined")+"» "+estado, nil)
	if activo {
		return Resultado{Ok: "Aviso activado."}, nil
	}
	return Resultado{Ok: "Aviso desactivado."}, nil
}

// GuardarTextoAviso edita el texto que se manda dentro de la ventana.
func (s *Servicio) GuardarTextoAviso(ctx context.Context, id, texto string) (Resultado, error) {
	t := trimJS(texto)
	if !plataforma.UUIDValido(id) || largoJS(t) > 1000 {
		return conError("Revisá el texto."), nil
	}
	if _, err := s.pool.Exec(ctx, `update whatsapp_avisos set texto_libre = $2, updated_at = now() where id = $1`, id, nulo(&t)); err != nil {
		return Resultado{}, err
	}
	return Resultado{Ok: "Texto guardado."}, nil
}

// Sincronizar trae las plantillas de Meta.
func (s *Servicio) Sincronizar(ctx context.Context) (Resultado, error) {
	r, err := s.SincronizarPlantillas(ctx)
	if err != nil {
		return Resultado{}, err
	}
	if r.Error != "" {
		return conError(r.Error), nil
	}
	return Resultado{Ok: "Listo: " + jsmath.Texto(float64(r.Total)) + " plantillas, " + jsmath.Texto(float64(r.Aprobadas)) + " aprobadas."}, nil
}

// Diagnosticar chequea la configuración contra Meta y lo guarda.
func (s *Servicio) Diagnosticar(ctx context.Context) (Resultado, error) {
	d := s.prov.Diagnosticar(ctx)
	crudo, _ := json.Marshal(d)
	var calidad, limite *string
	if d.Numero != nil {
		calidad, limite = d.Numero.Calidad, d.Numero.Limite
	}
	t, err := s.pool.Exec(ctx, `update whatsapp_sesion set diagnostico = $1, diagnostico_at = now(), calidad = $2, limite_mensajes = $3, updated_at = now()`,
		crudo, calidad, limite)
	if err != nil {
		return Resultado{}, err
	}
	if t.RowsAffected() == 0 {
		if _, err := s.pool.Exec(ctx, `insert into whatsapp_sesion (diagnostico, diagnostico_at, calidad, limite_mensajes, updated_at)
			values ($1, now(), $2, $3, now())`, crudo, calidad, limite); err != nil {
			return Resultado{}, err
		}
	}
	errores := 0
	for _, p := range d.Puntos {
		if p.Estado == "error" {
			errores++
		}
	}
	switch {
	case errores == 1:
		return conError("Hay 1 cosa para arreglar."), nil
	case errores > 1:
		return conError("Hay " + jsmath.Texto(float64(errores)) + " cosas para arreglar."), nil
	}
	return Resultado{Ok: "Todo en orden."}, nil
}

// MensajeDePrueba manda un mensaje a un número: texto si escribió en las
// últimas 24 h; si no, `hello_world` o la primera aprobada que sirva.
func (s *Servicio) MensajeDePrueba(ctx context.Context, ses *auth.Sesion, telefono string) (Resultado, error) {
	jid := AJid(trimJS(telefono))
	if jid == "" {
		return conError("Escribí un número válido, con característica."), nil
	}
	c, err := s.ConversacionDe(ctx, jid, nil, nil)
	if err != nil {
		return Resultado{}, err
	}
	abierta := VentanaAbierta(c.UltimoEntranteAt, s.ahora())
	var r ResultadoSaliente
	if abierta {
		cuerpo := "Mensaje de prueba de la plataforma de Maderera Juan B. Justo. Si lo ves, WhatsApp está conectado."
		r, err = s.EnviarYRegistrar(ctx, Envio{ConversacionID: c.ID, WaJid: jid, Mensaje: Saliente{Tipo: "texto", Cuerpo: cuerpo},
			Registro: Registro{Cuerpo: cuerpo}, Origen: "panel", EnviadoPor: &ses.UserID, ConfirmarTope: true})
	} else {
		p, err := s.PlantillaDisponible(ctx, "hello_world", "en_US")
		if err != nil {
			return Resultado{}, err
		}
		if p == nil {
			if p, err = s.PlantillaDisponible(ctx, "retomar_conversacion", ""); err != nil {
				return Resultado{}, err
			}
		}
		if p == nil {
			return conError("No hay ninguna plantilla aprobada para probar. Sincronizá las plantillas o escribile primero desde ese número."), nil
		}
		valores := SugerirValores(p.Plantilla, map[string]string{"nombre": strings.SplitN(ses.Nombre, " ", 2)[0]}, nil)
		r, err = s.EnviarYRegistrar(ctx, Envio{ConversacionID: c.ID, WaJid: jid,
			Mensaje:  Saliente{Tipo: "plantilla", Nombre: p.Nombre, Idioma: p.Idioma, Componentes: ArmarComponentes(p.Plantilla, valores, nil)},
			Registro: Registro{Cuerpo: VistaPrevia(p.Plantilla, valores), Plantilla: &p.Nombre}, Origen: "panel", EnviadoPor: &ses.UserID, ConfirmarTope: true})
		if err != nil {
			return Resultado{}, err
		}
	}
	if err != nil {
		return Resultado{}, err
	}
	if r.Error != nil {
		return conError(r.Error.Texto), nil
	}
	con := ""
	if !abierta {
		con = " con plantilla"
	}
	return Resultado{Ok: "Enviado" + con + ". Fijate en la bandeja cómo cambia el estado (enviado, entregado, leído)."}, nil
}

// leerUSD es el `usd` de zod del TS: «10», «0,026», «0.0618».
func leerUSD(v string) (float64, bool) {
	t := strings.Replace(trimJS(v), ",", ".", 1)
	n := jsmath.Numero(t)
	return n, !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0
}

// GuardarTope guarda el tope del mes y las tarifas. Con otro tope, los
// avisos de 80 % y 100 % se vuelven a evaluar.
func (s *Servicio) GuardarTope(ctx context.Context, ses *auth.Sesion, valores map[string]string) (Resultado, error) {
	tope, ok := leerUSD(valores["tope"])
	if !ok {
		return conError("Escribí un número."), nil
	}
	if !(tope <= 10_000) {
		return conError("El tope parece demasiado alto."), nil
	}
	tarifas := map[string]float64{}
	for _, c := range CategoriasCobro {
		n, ok := leerUSD(valores[c])
		if !ok {
			return conError("Escribí un número."), nil
		}
		if !(n < 10) {
			return conError("Esa tarifa parece demasiado alta."), nil
		}
		tarifas[c] = n
	}
	crudo, _ := json.Marshal(tarifas)
	fijo := jsmath.ToFixed(tope, 2)
	t, err := s.pool.Exec(ctx, `update whatsapp_sesion set tope_mensual_usd = $1::numeric, tarifas = $2, tope_aviso80 = null, tope_aviso100 = null, updated_at = now()`, fijo, crudo)
	if err != nil {
		return Resultado{}, err
	}
	if t.RowsAffected() == 0 {
		if _, err := s.pool.Exec(ctx, `insert into whatsapp_sesion (tope_mensual_usd, tarifas, updated_at) values ($1::numeric, $2, now())`, fijo, crudo); err != nil {
			return Resultado{}, err
		}
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "whatsapp", "", "Tope de WhatsApp: USD "+fijo+" por mes", nil)
	s.RevisarUmbrales(ctx)
	return Resultado{Ok: "Guardado."}, nil
}
