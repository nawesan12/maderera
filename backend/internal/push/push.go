// Package push avisa al teléfono del personal (el panel se instala como
// aplicación): un pedido nuevo de la tienda, un trabajo que no se pudo
// hacer, el parte del día. Es lib/notificaciones/push.ts con las mismas
// tablas y el mismo formato del aviso, que lee public/sw.js.
//
// **Nunca falla para afuera.** Un aviso que no sale no puede tirar abajo la
// venta que lo originó: se registra en notifications_log y se sigue.
package push

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

// Config son las claves VAPID (scripts/claves-push.sh las genera).
type Config struct {
	Publica string `env:"VAPID_PUBLIC_KEY"`
	Privada string `env:"VAPID_PRIVATE_KEY"`
	Sujeto  string `env:"VAPID_SUBJECT" envDefault:"mailto:info@mjbj.com.ar"`
}

// Aviso es lo que se muestra. Para elige a quién: un usuario, o el personal
// que puede abrir una pantalla; sin Para, a todos los dispositivos.
type Aviso struct {
	Titulo   string
	Cuerpo   string
	URL      string
	Etiqueta string
	Pantalla string
	Usuario  string
}

// Avisador manda.
type Avisador struct {
	cfg     Config
	q       *sqlc.Queries
	log     *slog.Logger
	cliente *http.Client
}

// Nuevo arma el avisador.
func Nuevo(cfg Config, q *sqlc.Queries, log *slog.Logger) *Avisador {
	return &Avisador{cfg: cfg, q: q, log: log, cliente: &http.Client{Timeout: 15 * time.Second}}
}

// Configurado dice si hay claves VAPID.
func (a *Avisador) Configurado() bool { return a.cfg.Publica != "" && a.cfg.Privada != "" }

type suscripcion struct{ id, endpoint, p256dh, auth string }

func (a *Avisador) destinatarios(ctx context.Context, av Aviso) ([]suscripcion, error) {
	var out []suscripcion
	agregar := func(id, e, p, k string) { out = append(out, suscripcion{id, e, p, k}) }
	switch {
	case av.Usuario != "":
		filas, err := a.q.SuscripcionesDeUsuario(ctx, av.Usuario)
		for _, f := range filas {
			agregar(f.ID, f.Endpoint, f.P256dh, f.Auth)
		}
		return out, err
	case av.Pantalla != "" && roles.QuienEntra(av.Pantalla) != nil:
		var nombres []string
		for _, r := range roles.QuienEntra(av.Pantalla) {
			nombres = append(nombres, string(r))
		}
		filas, err := a.q.SuscripcionesDeRoles(ctx, nombres)
		for _, f := range filas {
			agregar(f.ID, f.Endpoint, f.P256dh, f.Auth)
		}
		return out, err
	default:
		filas, err := a.q.TodasLasSuscripciones(ctx)
		for _, f := range filas {
			agregar(f.ID, f.Endpoint, f.P256dh, f.Auth)
		}
		return out, err
	}
}

// Avisar manda el aviso a cada dispositivo. Los que el servicio de push da
// por muertos (404, 410) se borran: el teléfono desinstaló la aplicación.
func (a *Avisador) Avisar(ctx context.Context, av Aviso) {
	if !a.Configurado() {
		a.registrar(ctx, av, sqlc.EstadoNotificacionOmitida, "Sin claves VAPID configuradas")
		return
	}
	subs, err := a.destinatarios(ctx, av)
	if err != nil {
		a.log.Error("push: buscando dispositivos", "error", err)
		return
	}
	if len(subs) == 0 {
		a.registrar(ctx, av, sqlc.EstadoNotificacionOmitida, "Ningún dispositivo con avisos activados")
		return
	}
	etiqueta := av.Etiqueta
	if etiqueta == "" {
		etiqueta = "mjbj"
	}
	// Las claves en español: es lo que lee public/sw.js.
	carga, _ := json.Marshal(map[string]string{"titulo": av.Titulo, "cuerpo": av.Cuerpo, "url": av.URL, "etiqueta": etiqueta})
	entregados := 0
	for _, s := range subs {
		resp, err := webpush.SendNotificationWithContext(ctx, carga, &webpush.Subscription{
			Endpoint: s.endpoint, Keys: webpush.Keys{P256dh: s.p256dh, Auth: s.auth},
		}, &webpush.Options{
			HTTPClient: a.cliente, Subscriber: a.cfg.Sujeto, TTL: 3600,
			VAPIDPublicKey: a.cfg.Publica, VAPIDPrivateKey: a.cfg.Privada,
		})
		if err != nil {
			a.log.Warn("push: no salió", "endpoint", s.endpoint, "error", err)
			continue
		}
		resp.Body.Close()
		switch {
		case resp.StatusCode/100 == 2:
			entregados++
			_ = a.q.SuscripcionUsada(ctx, s.id)
		case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
			_ = a.q.BorrarSuscripcionVencida(ctx, s.id)
		}
	}
	estado := sqlc.EstadoNotificacionEnviada
	if entregados == 0 {
		estado = sqlc.EstadoNotificacionFallida
	}
	a.registrar(ctx, av, estado, fmt.Sprintf("%d de %d dispositivos", entregados, len(subs)))
}

func (a *Avisador) registrar(ctx context.Context, av Aviso, estado sqlc.EstadoNotificacion, detalle string) {
	evento := av.Etiqueta
	if evento == "" {
		evento = "panel"
	}
	var err *string
	if estado != sqlc.EstadoNotificacionEnviada {
		err = &detalle
	}
	titulo := av.Titulo
	if e := a.q.RegistrarNotificacion(ctx, sqlc.RegistrarNotificacionParams{
		Canal: sqlc.CanalNotificacionPush, Evento: evento, Destinatario: "panel", Asunto: &titulo, Estado: estado, Error: err,
	}); e != nil {
		a.log.Error("push: registrando", "error", e)
	}
}
