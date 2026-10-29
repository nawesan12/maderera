package avisos

import (
	"context"
	"sort"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/push"
	"mjbj/internal/sqlc"
)

// La pantalla /admin/avisos (lib/dal/admin/avisos.ts, app/admin/avisos/*).

// OrdenEventos es ORDEN_EVENTOS de lib/notificaciones/titulos.ts: el ciclo
// de vida de un pedido, que es como se lee la lista.
var OrdenEventos = []string{
	"presupuesto_recibido", "presupuesto_listo", "pedido_recibido", "pago_acreditado", "preparando", "listo",
	"remito_para_firmar", "en-camino", "entregado", "remito_firmado", "factura_emitida", "solicitud_profesional",
	"profesional_aprobado", "profesional_rechazado", "inscripcion_evento", "recordatorio_evento",
}

func posicion(evento string) int {
	for i, e := range OrdenEventos {
		if e == evento {
			return i
		}
	}
	return len(OrdenEventos)
}

// porDefecto es POR_DEFECTO de lib/notificaciones/sembrar.ts.
var porDefecto = []struct {
	evento, asunto string
	encabezado     *string
}{
	{"pedido_recibido", "Recibimos tu pedido", nil},
	{"pago_acreditado", "Recibimos tu pago", nil},
	{"preparando", "Estamos preparando tu pedido", ptr("Estamos preparando tu pedido")},
	{"listo", "Tu pedido está listo para retirar", ptr("Tu pedido está listo")},
	{"en-camino", "Tu pedido salió para la entrega", ptr("Tu pedido salió para la entrega")},
	{"entregado", "Tu pedido fue entregado", ptr("Tu pedido fue entregado")},
	{"factura_emitida", "Tu comprobante", nil},
	{"presupuesto_listo", "Tu presupuesto está listo", nil},
	{"remito_firmado", "Constancia de entrega", nil},
	{"remito_para_firmar", "Firmá el remito de tu retiro", nil},
	{"presupuesto_recibido", "Recibimos tu pedido de presupuesto", nil},
	{"solicitud_profesional", "Recibimos tu solicitud de acceso profesional", nil},
	{"profesional_aprobado", "Tu acceso profesional está activo", nil},
	{"profesional_rechazado", "Sobre tu solicitud de acceso profesional", nil},
	{"inscripcion_evento", "Quedaste anotado", nil},
	{"recordatorio_evento", "Mañana te esperamos", nil},
	{"recibo_emitido", "Tu recibo de pago", nil},
	{"cheque_rechazado", "Un cheque tuyo fue rechazado", nil},
}

func ptr(s string) *string { return &s }

// Sembrar agrega los avisos que falten, sin tocar los que ya existen (si
// alguien apagó uno o le cambió el asunto, esa decisión manda).
func (s *Servicio) Sembrar(ctx context.Context) error {
	for _, a := range porDefecto {
		if _, err := s.pool.Exec(ctx, `insert into email_avisos (evento, asunto, encabezado, activo)
			values ($1, $2, $3, true) on conflict (evento) do nothing`, a.evento, a.asunto, a.encabezado); err != nil {
			return err
		}
	}
	return nil
}

// AvisoEmail es uno configurable.
type AvisoEmail struct {
	ID         string  `json:"id"`
	Evento     string  `json:"evento"`
	Asunto     string  `json:"asunto"`
	Encabezado *string `json:"encabezado"`
	Activo     bool    `json:"activo"`
}

// Listar siembra lo que falte y devuelve los avisos en el orden del ciclo
// de un pedido.
func (s *Servicio) Listar(ctx context.Context) ([]AvisoEmail, error) {
	if err := s.Sembrar(ctx); err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `select id, evento, asunto, encabezado, activo from email_avisos order by evento`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []AvisoEmail{}
	for filas.Next() {
		var a AvisoEmail
		if err := filas.Scan(&a.ID, &a.Evento, &a.Asunto, &a.Encabezado, &a.Activo); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	sort.SliceStable(out, func(i, j int) bool { return posicion(out[i].Evento) < posicion(out[j].Evento) })
	return out, filas.Err()
}

// Cambiar prende o apaga un aviso.
func (s *Servicio) Cambiar(ctx context.Context, id string, activo bool) error {
	_, err := s.pool.Exec(ctx, `update email_avisos set activo = $2, updated_at = now() where id = $1`, id, activo)
	return err
}

// GuardarTexto cambia el asunto y el encabezado.
func (s *Servicio) GuardarTexto(ctx context.Context, id, asunto string, encabezado *string) error {
	_, err := s.pool.Exec(ctx, `update email_avisos set asunto = $2, encabezado = $3, updated_at = now() where id = $1`, id, asunto, encabezado)
	return err
}

// EstadoCorreo dice si los correos salen y por dónde.
type EstadoCorreo struct {
	EnVivo    bool   `json:"enVivo"`
	Remitente string `json:"remitente"`
	Detalle   string `json:"detalle"`
}

// Estado es estadoCorreo.
func (s *Servicio) Estado() EstadoCorreo {
	e := EstadoCorreo{EnVivo: s.envio.Real(), Remitente: s.remitente}
	switch s.envio.Nombre() {
	case "smtp":
		e.Detalle = "Los correos salen por el servidor de correo propio."
	case "resend":
		e.Detalle = "Los correos salen por Resend."
	default:
		e.Detalle = "Falta conectar el envío (el servidor de correo propio o Resend). Los avisos se arman y quedan registrados, pero no se envían."
	}
	return e
}

// AvisoEnviado es una línea de la bitácora de avisos.
type AvisoEnviado struct {
	ID           string    `json:"id"`
	Canal        string    `json:"canal"`
	Evento       string    `json:"evento"`
	Destinatario string    `json:"destinatario"`
	Asunto       *string   `json:"asunto"`
	Estado       string    `json:"estado"`
	Error        *string   `json:"error"`
	CreatedAt    time.Time `json:"createdAt"`
}

// Ultimos son los últimos avisos de todos los canales.
func (s *Servicio) Ultimos(ctx context.Context, limite int) ([]AvisoEnviado, error) {
	filas, err := s.pool.Query(ctx, `select id, canal::text, evento, destinatario, asunto, estado::text, error, created_at
		from notifications_log order by created_at desc limit $1`, limite)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []AvisoEnviado{}
	for filas.Next() {
		var a AvisoEnviado
		if err := filas.Scan(&a.ID, &a.Canal, &a.Evento, &a.Destinatario, &a.Asunto, &a.Estado, &a.Error, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, filas.Err()
}

/* --------------------------- los avisos al panel --------------------------- */

// Suscripcion es la de un dispositivo.
type Suscripcion struct {
	Endpoint, P256dh, Auth string
	Descripcion            *string
}

// Suscribir guarda la suscripción del dispositivo de quien pide. Repetirla
// no la duplica (el navegador puede rotar las claves sin cambiar el
// endpoint).
func (s *Servicio) Suscribir(ctx context.Context, ses *auth.Sesion, sub Suscripcion) error {
	if sub.Endpoint == "" || sub.P256dh == "" || sub.Auth == "" {
		return plataforma.NuevoProblema(422, "El navegador no devolvió una suscripción completa.")
	}
	return s.q.GuardarSuscripcion(ctx, sqlc.GuardarSuscripcionParams{UserID: ses.UserID, Endpoint: sub.Endpoint, P256dh: sub.P256dh,
		Auth: sub.Auth, Descripcion: sub.Descripcion})
}

// Desuscribir saca el dispositivo (solo si es de quien pide).
func (s *Servicio) Desuscribir(ctx context.Context, ses *auth.Sesion, endpoint string) error {
	return s.q.BorrarSuscripcion(ctx, sqlc.BorrarSuscripcionParams{Endpoint: endpoint, UserID: ses.UserID})
}

// Probar manda un aviso de prueba a todo el panel.
func (s *Servicio) Probar(ctx context.Context, p *push.Avisador) error {
	if !p.Configurado() {
		return plataforma.NuevoProblema(422, "Faltan las claves VAPID en el servidor. Hasta que estén, los avisos no salen.")
	}
	p.Avisar(ctx, push.Aviso{Titulo: "Prueba de aviso", Cuerpo: "Si ves esto, el panel te va a avisar cuando entre una venta.",
		URL: "/admin", Etiqueta: "prueba"})
	return nil
}
