package plataforma

import (
	"net/http/httptest"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

func TestIPDelCliente(t *testing.T) {
	for _, c := range []struct {
		nombre, remota, xff, cf, quiero string
	}{
		{"directo de internet: no cree nada", "203.0.113.9:4000", "6.6.6.6", "7.7.7.7", "203.0.113.9"},
		{"detrás de Caddy, el último de la lista", "172.18.0.5:4000", "6.6.6.6, 198.51.100.2", "", "198.51.100.2"},
		{"detrás de Caddy, sin cabecera", "172.18.0.5:4000", "", "", "172.18.0.5"},
		{"con Cloudflare: el visitante", "172.18.0.5:4000", "162.158.10.20", "190.12.34.56", "190.12.34.56"},
		{"con Cloudflare por IPv6", "172.18.0.5:4000", "2606:4700:10::6816:1", "2800:810:abc::1", "2800:810:abc::1"},
		// Sin Cloudflare en el último salto, la cabecera la escribió el visitante.
		{"CF-Connecting-IP inventado", "172.18.0.5:4000", "198.51.100.2", "7.7.7.7", "198.51.100.2"},
		// Cloudflare sin la cabecera (o basura): el salto que se vio.
		{"Cloudflare sin la cabecera", "172.18.0.5:4000", "162.158.10.20", "no-es-ip", "162.158.10.20"},
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = c.remota
		if c.xff != "" {
			r.Header.Set("X-Forwarded-For", c.xff)
		}
		if c.cf != "" {
			r.Header.Set("CF-Connecting-IP", c.cf)
		}
		if got := IPDelCliente(r); got != c.quiero {
			t.Errorf("%s: %s, quería %s", c.nombre, got, c.quiero)
		}
	}
}

// Los rangos de Cloudflare del Caddyfile y los de Go son los mismos.
func TestRangosDeCloudflareComoElCaddyfile(t *testing.T) {
	b, err := os.ReadFile("../../../Caddyfile")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?m)^\s*trusted_proxies static (.+)$`).FindStringSubmatch(string(b))
	if m == nil {
		t.Fatal("el Caddyfile no declara trusted_proxies")
	}
	caddy := strings.Fields(m[1])
	if !slices.Equal(caddy, RangosDeCloudflare()) {
		t.Errorf("Caddyfile: %v\nGo:       %v", caddy, RangosDeCloudflare())
	}
	if !strings.Contains(string(b), "client_ip_headers CF-Connecting-IP") {
		t.Error("falta client_ip_headers CF-Connecting-IP")
	}
}
