package vivo

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// staff arma un pedido con sesión de personal del rol dado, sin pasar por la
// cookie: lo que se prueba acá es el reparto.
func conRol(c *Central, rol sqlc.StaffRole) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ses := &auth.Sesion{UserID: "u", Rol: sqlc.UserRoleStaff, RolStaff: &rol}
		c.ServeHTTP(w, r.WithContext(auth.ConSesion(r.Context(), ses)))
	})
}

func leerEventos(t *testing.T, url string, n int, hasta time.Duration) []string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), hasta)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	if r.Header.Get("Content-Type") != "text/event-stream; charset=utf-8" {
		t.Fatalf("content-type: %q (estado %d)", r.Header.Get("Content-Type"), r.StatusCode)
	}
	var eventos []string
	sc := bufio.NewScanner(r.Body)
	for sc.Scan() && len(eventos) < n {
		if l := sc.Text(); strings.HasPrefix(l, "event: ") {
			eventos = append(eventos, strings.TrimPrefix(l, "event: "))
		}
	}
	return eventos
}

func TestRepartoPorRol(t *testing.T) {
	pool := pruebas.Base(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c := Nueva(pool.Config().ConnString(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	go c.Correr(ctx)

	aserradero := httptest.NewServer(conRol(c, sqlc.StaffRoleAserradero))
	defer aserradero.Close()
	vendedor := httptest.NewServer(conRol(c, sqlc.StaffRoleVendedor))
	defer vendedor.Close()

	resultados := make(chan []string, 2)
	go func() { resultados <- leerEventos(t, aserradero.URL, 1, 5*time.Second) }()
	go func() { resultados <- leerEventos(t, vendedor.URL, 2, 5*time.Second) }()
	time.Sleep(500 * time.Millisecond) // que los dos estén suscriptos

	// Lo que mandaría un trigger: primero un WhatsApp (el aserradero no lo
	// ve), después un corte (lo ven los dos).
	for _, carga := range []string{`{"canal":"whatsapp","id":"c1"}`, `{"canal":"basura"}`, `{"canal":"taller","id":"t1","numero":"CRT-7","estado":"cortando"}`} {
		if _, err := pool.Exec(ctx, `select pg_notify('mjbj_vivo', $1)`, carga); err != nil {
			t.Fatal(err)
		}
	}
	a, b := <-resultados, <-resultados
	if len(a) > len(b) {
		a, b = b, a
	}
	if strings.Join(a, ",") != "taller" {
		t.Errorf("el aserradero recibió %v (solo tenía que ver taller)", a)
	}
	if strings.Join(b, ",") != "whatsapp,taller" {
		t.Errorf("el vendedor recibió %v", b)
	}
}

func TestSinPersonalNoHayStream(t *testing.T) {
	c := Nueva("", slog.New(slog.NewTextHandler(io.Discard, nil)))
	w := httptest.NewRecorder()
	c.ServeHTTP(w, httptest.NewRequest("GET", "/api/vivo", nil))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("sin sesión: %d", w.Code)
	}
}

// Mes simulado 2 (M2S4-012): un pedido del panel, y su cambio de estado,
// también se avisan (el canal solo publicaba los de la tienda); un update
// que no cambia el estado, no.
func TestLosPedidosDelPanelSeAvisan(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `listen mjbj_vivo`); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, origen, subtotal, total) values ('PED-1187', 'Ana', 'presupuesto', 1, 1) returning id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `update orders set notas = 'x' where id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `update orders set estado = 'cancelado' where id = $1`, id); err != nil {
		t.Fatal(err)
	}
	var cargas []string
	for i := 0; i < 2; i++ {
		espera, cancel := context.WithTimeout(ctx, 3*time.Second)
		n, err := conn.Conn().WaitForNotification(espera)
		cancel()
		if err != nil {
			t.Fatalf("aviso %d: %v (llegaron %v)", i, err, cargas)
		}
		cargas = append(cargas, n.Payload)
	}
	if !strings.Contains(cargas[0], `"nuevo": true`) || !strings.Contains(cargas[0], `"origen": "presupuesto"`) {
		t.Errorf("el alta: %s", cargas[0])
	}
	if !strings.Contains(cargas[1], `"estado": "cancelado"`) || !strings.Contains(cargas[1], `"nuevo": false`) {
		t.Errorf("la cancelación: %s", cargas[1])
	}
}
