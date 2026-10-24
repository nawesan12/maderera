package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// Las claves que daría un navegador al suscribirse.
func clavesDeNavegador(t *testing.T) (string, string) {
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	return base64.RawURLEncoding.EncodeToString(k.PublicKey().Bytes()), base64.RawURLEncoding.EncodeToString(auth)
}

func TestAvisarAlPanel(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	q := sqlc.New(pool)

	var recibidos atomic.Int32
	vivo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cuerpo, _ := io.ReadAll(r.Body)
		if r.Header.Get("Content-Encoding") != "aes128gcm" || len(cuerpo) == 0 || r.Header.Get("Authorization") == "" {
			t.Errorf("el aviso no llegó cifrado y firmado: %v", r.Header)
		}
		recibidos.Add(1)
		w.WriteHeader(http.StatusCreated)
	}))
	defer vivo.Close()
	muerto := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusGone) }))
	defer muerto.Close()

	// Un admin con dos dispositivos (uno desinstalado) y un aserradero.
	for _, u := range []struct{ id, rol string }{{"admin1", "admin"}, {"aserr1", "aserradero"}} {
		_, _ = pool.Exec(ctx, `insert into "user" (id, name, email) values ($1, $1, $1 || '@prueba.test')`, u.id)
		_, _ = pool.Exec(ctx, `insert into profiles (user_id, role, staff_role) values ($1, 'staff', $2)`, u.id, u.rol)
	}
	p1, a1 := clavesDeNavegador(t)
	p2, a2 := clavesDeNavegador(t)
	p3, a3 := clavesDeNavegador(t)
	for _, s := range [][4]string{{"admin1", vivo.URL + "/a", p1, a1}, {"admin1", muerto.URL + "/b", p2, a2}, {"aserr1", vivo.URL + "/c", p3, a3}} {
		if err := q.GuardarSuscripcion(ctx, sqlc.GuardarSuscripcionParams{UserID: s[0], Endpoint: s[1], P256dh: s[2], Auth: s[3]}); err != nil {
			t.Fatal(err)
		}
	}
	privada, publica, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	a := Nuevo(Config{Publica: publica, Privada: privada, Sujeto: "mailto:prueba@mjbj.com.ar"}, q, slog.New(slog.NewTextHandler(io.Discard, nil)))

	// /admin/caja es solo del admin: al aserradero no le llega.
	a.Avisar(ctx, Aviso{Titulo: "Cierre de caja", Cuerpo: "Falta el arqueo", URL: "/admin/caja", Pantalla: "/admin/caja"})
	if recibidos.Load() != 1 {
		t.Errorf("le llegó a %d dispositivos vivos, tenía que ser 1 (el del admin)", recibidos.Load())
	}
	var quedan int
	_ = pool.QueryRow(ctx, `select count(*) from push_subscriptions where user_id = 'admin1'`).Scan(&quedan)
	if quedan != 1 {
		t.Errorf("el dispositivo desinstalado (410) no se borró: quedan %d", quedan)
	}
	var estado, asunto string
	_ = pool.QueryRow(ctx, `select estado::text, asunto from notifications_log order by created_at desc limit 1`).Scan(&estado, &asunto)
	if estado != "enviada" || asunto != "Cierre de caja" {
		t.Errorf("registro: %s %q", estado, asunto)
	}

	// Sin claves: no se manda nada y queda registrado como omitido.
	Nuevo(Config{}, q, slog.New(slog.NewTextHandler(io.Discard, nil))).Avisar(ctx, Aviso{Titulo: "x"})
	_ = pool.QueryRow(ctx, `select estado::text from notifications_log order by created_at desc limit 1`).Scan(&estado)
	if estado != "omitida" {
		t.Errorf("sin claves: %s", estado)
	}
}
