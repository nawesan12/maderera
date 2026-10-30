package pagos

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"mjbj/internal/zodjs"
)

// Config son las credenciales de Mercado Pago (lib/pagos/config.ts). Viven
// solo en el entorno: un access token de producción mueve plata.
type Config struct {
	AccessToken   string `env:"MP_ACCESS_TOKEN"`
	WebhookSecret string `env:"MP_WEBHOOK_SECRET"`
	// Proveedor=demo fuerza el de demostración.
	Proveedor string `env:"PAGOS_PROVIDER"`
	// API es la base de la API de Mercado Pago: cambia solo en las pruebas
	// (un simulador).
	API          string `env:"MP_API_URL" envDefault:"https://api.mercadopago.com"`
	Sitio        string `env:"APP_URL"`
	SitioPublico string `env:"NEXT_PUBLIC_APP_URL"`
}

// URLBase es urlBase() del TS: la base pública del sitio, para los retornos.
func (c Config) URLBase() string {
	u := c.Sitio
	if u == "" {
		u = c.SitioPublico
	}
	if u == "" {
		u = "http://localhost:3000"
	}
	return strings.TrimSuffix(u, "/")
}

// URLWebhook es a dónde avisa Mercado Pago: la dirección de siempre.
func (c Config) URLWebhook() string { return c.URLBase() + "/api/pagos/webhook" }

// Preferencia es el checkout abierto.
type Preferencia struct {
	ID  string
	URL string
}

// Proveedor es con qué se cobra (lib/pagos/tipos.ts).
type Proveedor interface {
	Nombre() string // mercado_pago | demo
	Real() bool
	CrearPreferencia(ctx context.Context, s SolicitudPreferencia) (Preferencia, error)
	ConsultarPago(ctx context.Context, id string) (*PagoRemoto, error)
	InterpretarAviso(cuerpo any, query url.Values) *AvisoEntrante
}

// Elegir es proveedorPagos(): sin token, el de demostración.
func (c Config) Elegir() Proveedor {
	if c.Proveedor == "demo" || c.AccessToken == "" {
		return demo{c}
	}
	return &mercadoPago{c, &http.Client{Timeout: 20 * time.Second}}
}

// PorNombre es proveedorPorNombre: nil si Mercado Pago no está configurado.
func (c Config) PorNombre(nombre string) Proveedor {
	switch nombre {
	case "demo":
		return demo{c}
	case "mercado_pago":
		if c.AccessToken != "" {
			return &mercadoPago{c, &http.Client{Timeout: 20 * time.Second}}
		}
	}
	return nil
}

// --- el de demostración ---

type demo struct{ c Config }

func (demo) Nombre() string { return "demo" }
func (demo) Real() bool     { return false }
func (d demo) CrearPreferencia(_ context.Context, s SolicitudPreferencia) (Preferencia, error) {
	return Preferencia{ID: "pref-demo-" + s.Referencia, URL: d.c.URLBase() + "/pago-demo/" + s.Referencia}, nil
}
func (demo) ConsultarPago(_ context.Context, id string) (*PagoRemoto, error) {
	return ConsultarDemo(id), nil
}
func (demo) InterpretarAviso(cuerpo any, _ url.Values) *AvisoEntrante {
	return InterpretarAvisoDemo(cuerpo)
}

// --- Mercado Pago por HTTP, sin SDK ---

type mercadoPago struct {
	c   Config
	cli *http.Client
}

func (*mercadoPago) Nombre() string { return "mercado_pago" }
func (*mercadoPago) Real() bool     { return true }

func (m *mercadoPago) pedir(ctx context.Context, metodo, ruta string, cuerpo any, idempotencia string) ([]byte, error) {
	var b io.Reader
	if cuerpo != nil {
		j, err := json.Marshal(cuerpo)
		if err != nil {
			return nil, err
		}
		b = bytes.NewReader(j)
	}
	req, err := http.NewRequestWithContext(ctx, metodo, strings.TrimSuffix(m.c.API, "/")+ruta, b)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+m.c.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	// Si la red corta después de que Mercado Pago creó la preferencia, el
	// reintento devuelve la misma.
	if idempotencia != "" {
		req.Header.Set("X-Idempotency-Key", idempotencia)
	}
	res, err := m.cli.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	texto, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		corto := []rune(string(texto))
		if len(corto) > 400 {
			corto = corto[:400]
		}
		return nil, fmt.Errorf("Mercado Pago respondió %d: %s", res.StatusCode, string(corto))
	}
	return texto, nil
}

func (m *mercadoPago) CrearPreferencia(ctx context.Context, s SolicitudPreferencia) (Preferencia, error) {
	b, err := m.pedir(ctx, http.MethodPost, "/checkout/preferences", ArmarPreferencia(s), "pref-"+s.Referencia)
	if err != nil {
		return Preferencia{}, err
	}
	var r struct {
		ID               any     `json:"id"`
		InitPoint        string  `json:"init_point"`
		SandboxInitPoint *string `json:"sandbox_init_point"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return Preferencia{}, err
	}
	// Con credenciales de prueba, init_point no acepta las tarjetas de prueba.
	u := r.InitPoint
	if strings.HasPrefix(m.c.AccessToken, "TEST-") && r.SandboxInitPoint != nil {
		u = *r.SandboxInitPoint
	}
	return Preferencia{ID: zodjs.TextoJS(r.ID), URL: u}, nil
}

func (m *mercadoPago) ConsultarPago(ctx context.Context, id string) (*PagoRemoto, error) {
	b, err := m.pedir(ctx, http.MethodGet, "/v1/payments/"+url.PathEscape(id), nil, "")
	if err != nil {
		return nil, err
	}
	return PagoDeMercadoPago(b), nil
}

func (*mercadoPago) InterpretarAviso(cuerpo any, query url.Values) *AvisoEntrante {
	return InterpretarAvisoMP(cuerpo, query)
}
