package auth

import (
	"context"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// La vuelta: una sesión que abre Go la tiene que aceptar better-auth (Next la
// sigue leyendo mientras convivan). Este test registra un usuario con Go en
// MJBJ_BASE_CRUZADA y deja la cookie en MJBJ_COOKIE_CRUZADA; después
// scripts/golden/auth-verificar.ts la pasa por auth.api.getSession.
func TestCookieParaBetterAuth(t *testing.T) {
	base, salida := os.Getenv("MJBJ_BASE_CRUZADA"), os.Getenv("MJBJ_COOKIE_CRUZADA")
	if base == "" || salida == "" {
		t.Skip("sin MJBJ_BASE_CRUZADA / MJBJ_COOKIE_CRUZADA")
	}
	g := leerGolden(t)
	pool, err := pgxpool.New(context.Background(), base)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	s := Nuevo(Config{Secreto: g.Secreto, URL: "https://mjbj.com.ar"}, pool)
	w := httptest.NewRecorder()
	ses, err := s.Registrar(context.Background(), w, "Cruzada", "cruzada-"+nuevoID()[:8]+"@prueba.test", "una clave larga", "", "")
	if err != nil {
		t.Fatal(err)
	}
	par, _, _ := strings.Cut(w.Result().Header.Get("Set-Cookie"), ";")
	if err := os.WriteFile(salida, []byte(par+"\n"+ses.UserID+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}
