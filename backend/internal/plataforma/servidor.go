package plataforma

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"github.com/caarlos0/env/v11"
)

// Cargar lee la configuración de las variables de entorno y corta el
// arranque si falta algo obligatorio: un servicio que arranca a medias falla
// más tarde y más lejos de la causa.
func Cargar[T any]() (T, error) {
	return env.ParseAs[T]()
}

// Registro devuelve el logger en JSON que usan todos los servicios: es lo que
// lee `docker compose logs` y lo que se puede filtrar con jq.
func Registro(servicio string) *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})).
		With("servicio", servicio)
}

// Servir atiende hasta que llega SIGTERM o SIGINT y entonces deja terminar
// los pedidos en curso (hasta 20 s) antes de salir. Docker manda SIGTERM al
// redesplegar: sin esto, una venta a medio guardar se corta.
func Servir(direccion string, h http.Handler, log *slog.Logger) error {
	srv := &http.Server{
		Addr:              direccion,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute, // los adjuntos de 25 MB por una conexión lenta
		IdleTimeout:       2 * time.Minute,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}
	ctx, parar := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer parar()

	errores := make(chan error, 1)
	go func() {
		log.Info("escuchando", "direccion", direccion)
		errores <- srv.ListenAndServe()
	}()

	select {
	case err := <-errores:
		return err
	case <-ctx.Done():
	}
	log.Info("apagando")
	apagado, cancelar := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancelar()
	if err := srv.Shutdown(apagado); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// Cadena envuelve el manejador con lo que va en todos los servicios, de
// afuera hacia adentro: recuperar un pánico, registrar el pedido, las
// cabeceras de seguridad y la protección contra pedidos de otro origen.
func Cadena(h http.Handler, log *slog.Logger) http.Handler {
	csrf := http.NewCrossOriginProtection()
	csrf.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		EscribirProblema(w, NuevoProblema(http.StatusForbidden, "El pedido vino de otro sitio."))
	}))
	h = csrf.Handler(h)
	h = cabeceras(h)
	h = registrar(h, log)
	return recuperar(h, log)
}

type claveCtx int

const claveID claveCtx = 0

// IDDelPedido es el identificador que se registra con cada pedido; sirve para
// cruzar lo que vio la persona con lo que dice el registro.
func IDDelPedido(ctx context.Context) string {
	id, _ := ctx.Value(claveID).(string)
	return id
}

type respuestaRegistrada struct {
	http.ResponseWriter
	estado int
}

func (r *respuestaRegistrada) WriteHeader(estado int) {
	r.estado = estado
	r.ResponseWriter.WriteHeader(estado)
}

// Flush deja pasar el vaciado a la respuesta real (lo necesitan los
// streams).
func (r *respuestaRegistrada) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (r *respuestaRegistrada) Unwrap() http.ResponseWriter { return r.ResponseWriter }

// conToken son las rutas cuyo último tramo es un token que vale como una
// llave: el enlace de firma de un remito y la consulta de corte. No quedan
// escritos en el registro (comité del 25/11), como el link mágico en el de
// Caddy.
var conToken = []string{"/api/v1/firmar/", "/api/v1/cortes/consulta/"}

// RutaParaElLog es la ruta con el token tapado.
func RutaParaElLog(ruta string) string {
	for _, p := range conToken {
		if strings.HasPrefix(ruta, p) && len(ruta) > len(p) {
			return p + "oculto"
		}
	}
	return ruta
}

func registrar(h http.Handler, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b [8]byte
		_, _ = rand.Read(b[:])
		id := hex.EncodeToString(b[:])
		w.Header().Set("X-Pedido", id)
		r = r.WithContext(context.WithValue(r.Context(), claveID, id))
		rr := &respuestaRegistrada{ResponseWriter: w, estado: http.StatusOK}
		inicio := time.Now()
		h.ServeHTTP(rr, r)
		log.Info("pedido",
			"id", id,
			"metodo", r.Method,
			"ruta", RutaParaElLog(r.URL.Path),
			"estado", rr.estado,
			"ms", time.Since(inicio).Milliseconds(),
			"ip", IPDelCliente(r),
		)
	})
}

func recuperar(h http.Handler, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				log.Error("pánico", "id", IDDelPedido(r.Context()), "valor", v, "pila", string(debug.Stack()))
				EscribirProblema(w, NuevoProblema(http.StatusInternalServerError, "Algo falló de nuestro lado."))
			}
		}()
		h.ServeHTTP(w, r)
	})
}

func cabeceras(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c := w.Header()
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("Referrer-Policy", "same-origin")
		c.Set("X-Frame-Options", "DENY")
		h.ServeHTTP(w, r)
	})
}

// IPDelCliente es la IP real de quien pide. Detrás de Caddy, la conexión
// viene de la red de Docker y la IP de verdad está en X-Forwarded-For; esa
// cabecera solo se cree cuando el pedido llega desde una red privada (Caddy),
// porque de cualquier otro lado la puede escribir quien quiera.
//
// **Con Cloudflare adelante**, lo que Caddy ve es un servidor de Cloudflare.
// Caddy ya resuelve la IP del visitante con CF-Connecting-IP
// (`trusted_proxies` y `client_ip_headers` en el Caddyfile) y la escribe
// como único X-Forwarded-For; si igual llega al final una IP de Cloudflare
// (un Caddy sin esa configuración), se toma CF-Connecting-IP. Solo en ese
// caso: el último salto lo anotó Caddy, así que el pedido de verdad pasó por
// Cloudflare, que pisa esa cabecera. Sin eso la podría escribir cualquiera.
func IPDelCliente(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	directa, err := netip.ParseAddr(host)
	if err != nil || !(directa.IsPrivate() || directa.IsLoopback()) {
		return host
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Caddy agrega al final la IP que vio: es la única confiable de la
		// lista.
		partes := strings.Split(xff, ",")
		ultima := strings.TrimSpace(partes[len(partes)-1])
		if ip, err := netip.ParseAddr(ultima); err == nil && EsDeCloudflare(ip) {
			if cf, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get("CF-Connecting-IP"))); err == nil {
				return cf.String()
			}
		}
		return ultima
	}
	return host
}

// rangosDeCloudflare son los publicados en https://www.cloudflare.com/ips/
// (20/11/2026). Los mismos van en el Caddyfile (`trusted_proxies`): si
// Cloudflare suma uno, se cambian los dos.
var rangosDeCloudflare = func() []netip.Prefix {
	var out []netip.Prefix
	for _, r := range []string{
		"173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
		"141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
		"197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
		"104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
		"2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
		"2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
	} {
		out = append(out, netip.MustParsePrefix(r))
	}
	return out
}()

// RangosDeCloudflare son los rangos de arriba, como texto (para comparar con
// el Caddyfile).
func RangosDeCloudflare() []string {
	out := make([]string, len(rangosDeCloudflare))
	for i, p := range rangosDeCloudflare {
		out[i] = p.String()
	}
	return out
}

// EsDeCloudflare dice si la IP es de un servidor de Cloudflare.
func EsDeCloudflare(ip netip.Addr) bool {
	ip = ip.Unmap()
	for _, p := range rangosDeCloudflare {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// ConMasTiempoParaLeer le da a una ruta de subida más tiempo para leer el
// cuerpo que el ReadTimeout del servidor (2 minutos): el padrón de ARBA son
// unos 200 MB, que por una conexión lenta no entran. Solo esa ruta: el
// resto sigue con el tope de siempre contra el que manda un cuerpo eterno.
func ConMasTiempoParaLeer(h http.Handler, metodo, ruta string, d time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == metodo && r.URL.Path == ruta {
			_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(d))
		}
		h.ServeHTTP(w, r)
	})
}
