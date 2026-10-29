package whatsapp

import (
	"context"
	"encoding/json"

	"mjbj/internal/push"
)

// La única puerta de salida de un mensaje (lib/whatsapp/envio.ts). La
// bandeja, los avisos automáticos, el PDF desde la pantalla de un remito y la
// confirmación de una baja pasan todos por acá. El orden es el que hace que
// nunca se pierda lo que se escribió: se guarda `pendiente`, se manda, y
// queda `enviado` con el id de Meta o `fallido` con el motivo.
//
// El tope del mes: lo que manda una persona desde la bandeja no se frena en
// silencio, vuelve con la acción «tope» para que la pantalla pida
// confirmarlo. Los avisos automáticos se cortan antes (avisos.go); la
// confirmación de una baja sale siempre.

// ErrorTope es lo que vuelve cuando el tope frena un envío de la bandeja.
var ErrorTope = ErrorDeEnvio{
	Texto:  "Este mes ya se llegó al tope de gasto de WhatsApp. Si lo mandás por acá, Meta lo cobra igual. Gratis: contestá desde la app del teléfono.",
	Accion: AccionTope,
}

// MediaRegistro es el adjunto de un saliente, ya guardado en lo privado.
type MediaRegistro struct {
	Referencia string
	Tipo       string
	Mime       string
	Nombre     *string
	Bytes      *int
	MediaID    *string
}

// Registro es lo que se muestra en la burbuja.
type Registro struct {
	Cuerpo    string
	Tipo      string
	Media     *MediaRegistro
	Plantilla *string
	Citado    *string
	Datos     obj
}

// Envio es todo lo que necesita EnviarYRegistrar.
type Envio struct {
	ConversacionID string
	WaJid          string
	Mensaje        Saliente
	Registro       Registro
	Origen         string // panel, aviso, sistema
	EnviadoPor     *string
	// ReintentoDe: se actualiza esa fila en vez de crear otra.
	ReintentoDe *string
	// ConfirmarTope: desde la bandeja, la persona ya confirmó.
	ConfirmarTope bool
}

// ResultadoSaliente es cómo terminó.
type ResultadoSaliente struct {
	MensajeID   string
	WaMessageID string
	Error       *ErrorDeEnvio
}

// EnviarYRegistrar guarda, manda y anota el resultado.
func (s *Servicio) EnviarYRegistrar(ctx context.Context, o Envio) (ResultadoSaliente, error) {
	if o.Origen == "panel" && !o.ConfirmarTope {
		if s.TopeAlcanzado(ctx) {
			id := ""
			if o.ReintentoDe != nil {
				id = *o.ReintentoDe
			}
			e := ErrorTope
			return ResultadoSaliente{MensajeID: id, Error: &e}, nil
		}
	}
	ahora := s.ahora()
	cuerpo := Limpiar(o.Registro.Cuerpo)
	var mensajeID string
	if o.ReintentoDe != nil {
		mensajeID = *o.ReintentoDe
		if _, err := s.pool.Exec(ctx, `update whatsapp_mensajes set estado = 'pendiente', error_codigo = null, error_detalle = null,
			estado_at = $2, ocurrido_at = $2 where id = $1`, mensajeID, ahora); err != nil {
			return ResultadoSaliente{}, err
		}
	} else {
		m := o.Registro.Media
		tipo := o.Registro.Tipo
		if tipo == "" {
			switch {
			case m != nil:
				tipo = m.Tipo
			case o.Mensaje.Tipo == "plantilla":
				tipo = "template"
			default:
				tipo = "text"
			}
		}
		// Lo que se le pidió a Meta, tal cual: reintentar es volver a mandar esto.
		datos := obj{}
		for k, v := range o.Registro.Datos {
			datos[k] = v
		}
		datos["envio"] = o.Mensaje
		crudo, _ := json.Marshal(datos)
		var ref, mtipo, mmime, mestado *string
		var mnombre, mid *string
		var mbytes *int
		if m != nil {
			ref, mtipo, mmime, mestado = &m.Referencia, &m.Tipo, &m.Mime, ptr("listo")
			mnombre, mbytes, mid = m.Nombre, m.Bytes, m.MediaID
		}
		if err := s.pool.QueryRow(ctx, `
			insert into whatsapp_mensajes (conversacion_id, direccion, tipo, cuerpo, media_url, media_tipo, media_mime, media_nombre,
				media_bytes, media_id, media_estado, plantilla, citado_wa_message_id, datos, enviado_por_user_id, estado, estado_at,
				origen, ocurrido_at)
			values ($1, 'saliente', $2, $3, $4, $5::tipo_media, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pendiente', $15, $16, $15)
			returning id`,
			o.ConversacionID, tipo, cuerpo, ref, mtipo, mmime, mnombre, mbytes, mid, mestado, o.Registro.Plantilla, o.Registro.Citado,
			crudo, o.EnviadoPor, ahora, o.Origen).Scan(&mensajeID); err != nil {
			return ResultadoSaliente{}, err
		}
		tipoResumen := "text"
		if m != nil {
			tipoResumen = m.Tipo
		}
		if _, err := s.pool.Exec(ctx, `update whatsapp_conversaciones set ultimo_mensaje_at = $2, ultimo_mensaje_preview = $3, updated_at = $2
			where id = $1`, o.ConversacionID, ahora, Resumen(cuerpo, tipoResumen)); err != nil {
			return ResultadoSaliente{}, err
		}
	}

	waID, errEnvio := s.prov.Enviar(ctx, DestinoDeJid(o.WaJid), o.Mensaje)
	if errEnvio != nil || waID == "" {
		if errEnvio == nil {
			errEnvio = &ErrorDeEnvio{Texto: "No se pudo enviar.", Accion: AccionReintentar}
		}
		if _, err := s.pool.Exec(ctx, `update whatsapp_mensajes set estado = 'fallido', estado_at = now(), error_codigo = $2, error_detalle = $3
			where id = $1`, mensajeID, enteroCodigo(errEnvio.Codigo), cortarJS(errEnvio.Texto, 500)); err != nil {
			return ResultadoSaliente{}, err
		}
		return ResultadoSaliente{MensajeID: mensajeID, Error: errEnvio}, nil
	}
	if _, err := s.pool.Exec(ctx, `update whatsapp_mensajes set wa_message_id = $2, estado = 'enviado', estado_at = now() where id = $1`,
		mensajeID, waID); err != nil {
		return ResultadoSaliente{}, err
	}
	// Cada mensaje que sale puede pasar el 80 % o el 100 % del tope.
	s.RevisarUmbrales(ctx)
	return ResultadoSaliente{MensajeID: mensajeID, WaMessageID: waID}, nil
}

// avisoTope es el aviso al admin al pasar un umbral.
func avisoTope(umbral int, usd, tope float64) push.Aviso {
	if umbral == 100 {
		return push.Aviso{
			Titulo:   "WhatsApp llegó al tope del mes",
			Cuerpo:   "Van " + Dolares(usd) + " de " + Dolares(tope) + ". Los avisos automáticos dejan de salir por WhatsApp hasta el mes que viene; el correo sigue. Avisá desde el teléfono, que es gratis.",
			URL:      "/admin/whatsapp/configuracion",
			Etiqueta: "whatsapp-tope",
			Pantalla: "/admin/whatsapp/configuracion",
		}
	}
	return push.Aviso{
		Titulo:   "WhatsApp va por el 80 % del tope",
		Cuerpo:   "Van " + Dolares(usd) + " de " + Dolares(tope) + " este mes. Contestar desde el teléfono es gratis.",
		URL:      "/admin/whatsapp/configuracion",
		Etiqueta: "whatsapp-tope",
		Pantalla: "/admin/whatsapp/configuracion",
	}
}
