// Package whatsapp es la bandeja de WhatsApp del panel y todo lo que la
// alimenta: el webhook de Meta (con la firma), los envíos por la Graph API
// (o el proveedor de demostración), los adjuntos privados, las plantillas y
// su sincronización, la ventana de 24 h, el gasto contra el tope del mes y
// los avisos automáticos. Era lib/whatsapp, lib/dal/admin/whatsapp.ts,
// app/admin/whatsapp y app/api/whatsapp del TS, con las mismas tablas.
//
// Dos reglas que vienen del TS y no se negocian:
//
//   - **Nunca se pierde lo que se escribió**: un mensaje se guarda
//     `pendiente`, se manda y queda `enviado` o `fallido` con el motivo
//     (EnviarYRegistrar es la única puerta de salida).
//   - **Todo lo del webhook es idempotente**: Meta reintenta durante días y la
//     cola también; los mensajes se cortan por su id, los estados no
//     retroceden.
package whatsapp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/push"
	"mjbj/internal/sqlc"
)

// VersionGraph es la versión de la Graph API contra la que se escribió esto
// (se pisa con WHATSAPP_GRAPH_VERSION): actualizarla es una decisión.
const VersionGraph = "v26.0"

const urlGraph = "https://graph.facebook.com"

// Config son las credenciales de la Cloud API y dónde van los adjuntos. Las
// mismas variables que leía lib/whatsapp/config.ts.
type Config struct {
	PhoneNumberID  string `env:"WHATSAPP_PHONE_NUMBER_ID"`
	AccessToken    string `env:"WHATSAPP_ACCESS_TOKEN"`
	WabaID         string `env:"WHATSAPP_BUSINESS_ACCOUNT_ID"`
	AppSecret      string `env:"WHATSAPP_APP_SECRET"`
	WebhookSecret  string `env:"WHATSAPP_WEBHOOK_SECRET"`
	Telefono       string `env:"WHATSAPP_BUSINESS_PHONE"`
	GraphVersion   string `env:"WHATSAPP_GRAPH_VERSION"`
	GraphURL       string `env:"WHATSAPP_GRAPH_URL"`
	Proveedor      string `env:"WHATSAPP_PROVIDER"`
	CarpetaPrivada string `env:"CARPETA_PRIVADA" envDefault:"/datos/privado"`
	CarpetaSubidas string `env:"CARPETA_SUBIDAS" envDefault:"/datos/subidas"`
	// URLBase es la del sitio, para los enlaces que van en los mensajes
	// (urlBase de lib/pagos/config.ts).
	URLBase string `env:"APP_URL"`
}

// limpia recorta los espacios, como el TS (`?.trim()`).
func (c Config) limpia() Config {
	for _, p := range []*string{&c.PhoneNumberID, &c.AccessToken, &c.WabaID, &c.AppSecret, &c.GraphVersion, &c.GraphURL} {
		*p = strings.TrimSpace(*p)
	}
	if c.GraphVersion == "" {
		c.GraphVersion = VersionGraph
	}
	if c.GraphURL == "" {
		c.GraphURL = urlGraph
	}
	c.GraphURL = strings.TrimRight(c.GraphURL, "/")
	c.URLBase = strings.TrimRight(c.URLBase, "/")
	if c.URLBase == "" {
		c.URLBase = "http://localhost:3000"
	}
	return c
}

// HayCloud dice si están las credenciales mínimas para enviar.
func (c Config) HayCloud() bool { return c.PhoneNumberID != "" && c.AccessToken != "" }

// UsaSimulador dice si se habla con el simulador y no con Meta.
func (c Config) UsaSimulador() bool { return c.HayCloud() && !strings.HasPrefix(c.GraphURL, urlGraph) }

// Servicio es WhatsApp.
type Servicio struct {
	pool  *pgxpool.Pool
	q     *sqlc.Queries
	log   *slog.Logger
	cfg   Config
	prov  Proveedor
	push  *push.Avisador
	ahora func() time.Time
	// espera es cuánto se espera entre los reintentos de un estado que llegó
	// antes que el id del mensaje (700 ms en el TS). Las pruebas la acortan.
	espera time.Duration
}

// Nuevo arma el servicio. `avisos` puede ser nil (sin avisos al teléfono).
func Nuevo(pool *pgxpool.Pool, cfg Config, avisos *push.Avisador, log *slog.Logger) *Servicio {
	cfg = cfg.limpia()
	s := &Servicio{pool: pool, q: sqlc.New(pool), log: log, cfg: cfg, push: avisos, ahora: time.Now, espera: 700 * time.Millisecond}
	s.prov = elegirProveedor(cfg)
	return s
}

// ConProveedor cambia el proveedor (las pruebas usan uno falso).
func (s *Servicio) ConProveedor(p Proveedor) *Servicio { s.prov = p; return s }

// Proveedor es el que está en uso.
func (s *Servicio) Proveedor() Proveedor { return s.prov }

// Config es la configuración en uso.
func (s *Servicio) Config() Config { return s.cfg }

func elegirProveedor(cfg Config) Proveedor {
	if cfg.Proveedor == "demo" || !cfg.HayCloud() {
		return &Demo{telefono: cfg.Telefono}
	}
	return NuevoCloud(cfg)
}

func (s *Servicio) avisar(ctx context.Context, a push.Aviso) {
	if s.push == nil {
		return
	}
	s.push.Avisar(ctx, a)
}

func uuid() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b[:])
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}
