// Package avisos son los avisos automáticos por correo y su panel: lo que
// hacía despacharEmail de lib/notificaciones/avisos.ts (mandar, respetar el
// aviso apagado y el asunto editado, y dejarlo en notifications_log), el
// reintento de la cola (`email.reintento`), la pantalla /admin/avisos y los
// avisos al teléfono del panel (suscribir, borrar, probar).
//
// Las tres reglas del TS no cambian: un aviso nunca frena la operación, todo
// queda en notifications_log, y `simulada` no es `enviada`.
//
// Todos los avisos por correo salen de acá (internal/notificaciones y
// profesionales los arman); el despacharEmail del TS ya no existe.
package avisos

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/cola"
	"mjbj/internal/email"
	"mjbj/internal/sqlc"
)

// TipoReintento es el trabajo de la cola de un correo que rebotó
// temporalmente.
const TipoReintento = "email.reintento"

// Servicio manda y registra.
type Servicio struct {
	pool      *pgxpool.Pool
	q         *sqlc.Queries
	envio     email.Proveedor
	remitente string
	log       *slog.Logger
	ahora     func() time.Time
}

// Nuevo arma el servicio. El remitente es EMAIL_REMITENTE (lo que se
// muestra en el panel).
func Nuevo(pool *pgxpool.Pool, envio email.Proveedor, remitente string, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), envio: envio, remitente: remitente, log: log, ahora: time.Now}
}

// Envio es el proveedor de correo.
func (s *Servicio) Envio() email.Proveedor { return s.envio }

// Correo es un aviso armado.
type Correo struct{ Asunto, HTML, Texto string }

// Despacho es un aviso a mandar.
type Despacho struct {
	Evento      string
	Para        string
	Correo      Correo
	EntidadTipo string
	EntidadID   string
	// Adjuntos: el PDF del recibo o del comprobante. Si el correo rebota
	// temporalmente, viajan con el reintento.
	Adjuntos []email.Adjunto
}

// Reintento es la carga de `email.reintento` (ReintentoDeEmail del TS).
type Reintento struct {
	Evento      string          `json:"evento"`
	Para        string          `json:"para"`
	Asunto      string          `json:"asunto"`
	HTML        string          `json:"html"`
	Texto       string          `json:"texto"`
	Adjuntos    []AdjuntoBase64 `json:"adjuntos,omitempty"`
	EntidadTipo *string         `json:"entidadTipo"`
	EntidadID   *string         `json:"entidadId"`
}

// AdjuntoBase64 es un adjunto del reintento.
type AdjuntoBase64 struct {
	Nombre string `json:"nombre"`
	Tipo   string `json:"tipo"`
	Base64 string `json:"base64"`
}

func nulo(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Despachar manda un correo y lo registra. No falla nunca: un aviso que no
// sale queda anotado y la operación que lo originó sigue.
//
// Sin fila de configuración el aviso se manda (los eventos nacen
// encendidos); apagado, queda «omitida»; con asunto editado, sale con ese.
// Un rechazo temporal (el tope de Hostinger) va a la cola a los 2 minutos.
func (s *Servicio) Despachar(ctx context.Context, d Despacho) {
	if d.Para == "" {
		return
	}
	var asuntoConfig string
	var activo bool
	err := s.pool.QueryRow(ctx, `select asunto, activo from email_avisos where evento = $1 limit 1`, d.Evento).Scan(&asuntoConfig, &activo)
	hayConfig := err == nil
	if err != nil && err != pgx.ErrNoRows {
		s.log.Error("avisos: leyendo la configuración", "evento", d.Evento, "error", err)
		return
	}
	asunto := d.Correo.Asunto
	if hayConfig && !activo {
		s.registrar(ctx, d.Evento, d.Para, asunto, d.EntidadTipo, d.EntidadID, sqlc.EstadoNotificacionOmitida, "", "El aviso está apagado en /admin/avisos.")
		return
	}
	if hayConfig && asuntoConfig != "" {
		asunto = asuntoConfig
	}
	r := s.envio.Enviar(ctx, email.Mensaje{Para: d.Para, Asunto: asunto, HTML: d.Correo.HTML, Texto: d.Correo.Texto, Adjuntos: d.Adjuntos})
	if !r.Enviado && r.Temporal {
		s.registrar(ctx, d.Evento, d.Para, asunto, d.EntidadTipo, d.EntidadID, sqlc.EstadoNotificacionFallida, "", "Rechazo temporal, se reintenta: "+r.Error)
		carga := Reintento{Evento: d.Evento, Para: d.Para, Asunto: asunto, HTML: d.Correo.HTML, Texto: d.Correo.Texto,
			EntidadTipo: nulo(d.EntidadTipo), EntidadID: nulo(d.EntidadID)}
		for _, a := range d.Adjuntos {
			carga.Adjuntos = append(carga.Adjuntos, AdjuntoBase64{Nombre: a.Nombre, Tipo: a.Tipo, Base64: base64.StdEncoding.EncodeToString(a.Contenido)})
		}
		if _, err := cola.Encolar(ctx, s.q, TipoReintento, carga, s.ahora().Add(2*time.Minute)); err != nil {
			s.log.Error("avisos: no se pudo encolar el reintento", "evento", d.Evento, "error", err)
		}
		return
	}
	s.registrar(ctx, d.Evento, d.Para, asunto, d.EntidadTipo, d.EntidadID, estadoDe(r), r.ID, r.Error)
}

func estadoDe(r email.Resultado) sqlc.EstadoNotificacion {
	switch {
	case r.Simulado:
		return sqlc.EstadoNotificacionSimulada
	case r.Enviado:
		return sqlc.EstadoNotificacionEnviada
	}
	return sqlc.EstadoNotificacionFallida
}

func (s *Servicio) registrar(ctx context.Context, evento, para, asunto, entidadTipo, entidadID string, estado sqlc.EstadoNotificacion, idProveedor, falla string) {
	if _, err := s.pool.Exec(ctx, `insert into notifications_log
		(canal, evento, destinatario, asunto, entidad_tipo, entidad_id, estado, proveedor_mensaje_id, error)
		values ('email', $1, $2, $3, $4, $5::uuid, $6, $7, $8)`,
		evento, para, nulo(asunto), nulo(entidadTipo), nulo(entidadID), estado, nulo(idProveedor), nulo(falla)); err != nil {
		s.log.Error("avisos: no se pudo registrar", "evento", evento, "error", err)
	}
}

// ManejadorReintento es `email.reintento`: si vuelve a rebotar
// temporalmente, falla y la cola espera más; si el rechazo es definitivo,
// queda registrado y no se insiste.
func (s *Servicio) ManejadorReintento() cola.Manejador {
	return func(ctx context.Context, crudo json.RawMessage) error {
		var c Reintento
		if err := json.Unmarshal(crudo, &c); err != nil {
			return fmt.Errorf("la carga del reintento no se entiende: %w", err)
		}
		m := email.Mensaje{Para: c.Para, Asunto: c.Asunto, HTML: c.HTML, Texto: c.Texto}
		for _, a := range c.Adjuntos {
			b, err := base64.StdEncoding.DecodeString(a.Base64)
			if err != nil {
				return fmt.Errorf("el adjunto %s no se entiende: %w", a.Nombre, err)
			}
			m.Adjuntos = append(m.Adjuntos, email.Adjunto{Nombre: a.Nombre, Contenido: b, Tipo: a.Tipo})
		}
		r := s.envio.Enviar(ctx, m)
		if !r.Enviado && r.Temporal {
			if r.Error == "" {
				return fmt.Errorf("Rechazo temporal.")
			}
			return fmt.Errorf("%s", r.Error)
		}
		tipo, id := "", ""
		if c.EntidadTipo != nil {
			tipo = *c.EntidadTipo
		}
		if c.EntidadID != nil {
			id = *c.EntidadID
		}
		s.registrar(ctx, c.Evento, c.Para, c.Asunto, tipo, id, estadoDe(r), r.ID, r.Error)
		return nil
	}
}
