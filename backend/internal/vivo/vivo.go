// Package vivo reparte por SSE lo que pasa en la base, al instante: un pedido
// nuevo de la tienda, un corte que cambió de estado, un WhatsApp que entró,
// precios que se actualizaron. Es lib/vivo del TS: los mismos canales y el
// mismo formato de eventos, así las pantallas no cambian.
//
// Los avisos los mandan triggers de la base (`pg_notify('mjbj_vivo', …)`,
// migración 0074): ningún camino que cambie esas tablas se olvida de avisar,
// y el aviso sale recién cuando la transacción confirma. Acá hay una sola
// conexión escuchando por proceso, que reparte a todas las pantallas
// abiertas.
package vivo

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

// Canal es un tipo de evento.
type Canal string

const (
	WhatsApp Canal = "whatsapp"
	Taller   Canal = "taller"
	Pedidos  Canal = "pedidos"
	Precios  Canal = "precios"
)

// Quién recibe cada canal: los roles de la pantalla que lo muestra
// (PANTALLA_DEL_CANAL en lib/vivo/canales.ts), según el mapa de permisos del
// panel. Una pantalla que no se puede abrir no recibe sus avisos.
var rolesDelCanal = map[Canal][]sqlc.StaffRole{
	WhatsApp: roles.QuienEntra("/admin/whatsapp"),
	Taller:   roles.QuienEntra("/admin/cortes"),
	Pedidos:  roles.QuienEntra("/admin/pedidos"),
	Precios:  roles.QuienEntra("/mostrador"),
}

// Evento es lo que manda el trigger.
type Evento struct {
	Canal  Canal  `json:"canal"`
	ID     string `json:"id,omitempty"`
	Numero string `json:"numero,omitempty"`
	Estado string `json:"estado,omitempty"`
}

// Lo que se encola por pantalla antes de empezar a descartar: una pantalla
// que no lee (la pestaña colgada, la red lenta) no puede trabar a las demás.
const bufferPorPantalla = 64

type suscriptor struct {
	eventos    chan []byte // ya formateado para SSE
	reconexion chan struct{}
	canales    map[Canal]bool
}

// Central escucha la base y reparte.
type Central struct {
	url  string
	log  *slog.Logger
	mu   sync.Mutex
	subs map[*suscriptor]struct{}
	// Listo se cierra cuando la primera conexión quedó escuchando.
	listo   chan struct{}
	unaVez  sync.Once
	escucha bool
}

// Nueva arma la central; Correr la pone a escuchar.
func Nueva(urlBase string, log *slog.Logger) *Central {
	return &Central{url: urlBase, log: log, subs: map[*suscriptor]struct{}{}, listo: make(chan struct{})}
}

// Correr escucha hasta que se cancele el contexto, reconectando con espera
// creciente (1 s, 2 s… hasta 30 s) si se corta.
func (c *Central) Correr(ctx context.Context) {
	espera := time.Second
	for ctx.Err() == nil {
		err := c.escuchar(ctx)
		if ctx.Err() != nil {
			return
		}
		c.log.Error("vivo: conexión caída", "error", err, "reintento_en", espera)
		c.mu.Lock()
		c.escucha = false
		for s := range c.subs {
			select {
			case s.reconexion <- struct{}{}:
			default:
			}
		}
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-time.After(espera):
		}
		espera = min(espera*2, 30*time.Second)
	}
}

func (c *Central) escuchar(ctx context.Context) error {
	conn, err := pgx.Connect(ctx, c.url)
	if err != nil {
		return err
	}
	defer conn.Close(context.Background())
	if _, err := conn.Exec(ctx, "LISTEN mjbj_vivo"); err != nil {
		return err
	}
	c.mu.Lock()
	c.escucha = true
	c.mu.Unlock()
	c.unaVez.Do(func() { close(c.listo) })
	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		var e Evento
		if json.Unmarshal([]byte(n.Payload), &e) != nil || rolesDelCanal[e.Canal] == nil {
			continue
		}
		c.repartir(e)
	}
}

func (c *Central) repartir(e Evento) {
	datos, _ := json.Marshal(e)
	linea := []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", e.Canal, datos))
	c.mu.Lock()
	defer c.mu.Unlock()
	for s := range c.subs {
		if !s.canales[e.Canal] {
			continue
		}
		select {
		case s.eventos <- linea:
		default: // pantalla lenta: se pierde este aviso, no se traba nadie
		}
	}
}

// Escuchando dice si la conexión está arriba (para /salud).
func (c *Central) Escuchando() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.escucha
}

const latido = 25 * time.Second

// ServeHTTP es GET /api/v1/vivo (y /api/vivo, la dirección vieja que usan
// las pantallas). Mismo contrato que la ruta de Next: 401 sin personal, 204
// si su rol no ve ningún canal, y el stream si no.
func (c *Central) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ses := auth.DeContexto(r.Context())
	if !ses.EsStaff() {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	canales := map[Canal]bool{}
	var nombres []string
	for canal, roles := range rolesDelCanal {
		if ses.Tiene(roles...) {
			canales[canal] = true
			nombres = append(nombres, string(canal))
		}
	}
	if len(canales) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	select {
	case <-c.listo:
	case <-time.After(5 * time.Second):
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	case <-r.Context().Done():
		return
	}
	vaciar, ok := w.(http.Flusher)
	if !ok {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	s := &suscriptor{eventos: make(chan []byte, bufferPorPantalla), reconexion: make(chan struct{}, 1), canales: canales}
	c.mu.Lock()
	c.subs[s] = struct{}{}
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.subs, s)
		c.mu.Unlock()
	}()

	// Una conexión que dura horas: sin los plazos de lectura y escritura del
	// servidor (que son para pedidos comunes).
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})

	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	// Cada cuánto reconecta el navegador si se corta, y qué canales recibe
	// (un comentario: lo ve quien depura, la pantalla lo ignora).
	fmt.Fprintf(w, "retry: 5000\n: %s\n\n", strings.Join(nombres, ","))
	vaciar.Flush()

	reloj := time.NewTicker(latido)
	defer reloj.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case linea := <-s.eventos:
			if _, err := w.Write(linea); err != nil {
				return
			}
		case <-s.reconexion:
			// La conexión con la base se cortó: lo que pasó mientras tanto no
			// llegó. La pantalla recarga lo suyo (es lo que hace con este evento).
			if _, err := fmt.Fprint(w, "event: reconexion\ndata: {}\n\n"); err != nil {
				return
			}
		case <-reloj.C:
			if _, err := fmt.Fprint(w, ": latido\n\n"); err != nil {
				return
			}
		}
		vaciar.Flush()
	}
}
