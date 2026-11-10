package auth

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// La clave después de un link (revisión del 10/11/2026): la cuenta que creó
// la aprobación no tenía cómo ponerse clave, y el «olvidé mi clave» entraba
// pero no dejaba cambiarla (pedía la actual).
func TestClaveDespuesDelLink(t *testing.T) {
	g := leerGolden(t)
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := servicio(t, pool, g, "http://localhost:3100")
	leer := func(w *httptest.ResponseRecorder) *Sesion {
		t.Helper()
		ses, _ := s.Leer(httptest.NewRecorder(), pedidoConCookies(setCookies(w)))
		if ses == nil {
			t.Fatal("sin sesión")
		}
		return ses
	}

	// Una cuenta sin clave la pone sin dar «la actual».
	id, err := CrearCuentaSinClave(ctx, sqlc.New(pool), "Ana", "ana@prueba.test", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	token, _ := NuevoEnlace(ctx, pool, id, EnlaceActivacion, VenceActivacion, time.Now())
	w := httptest.NewRecorder()
	if _, _, err := s.UsarEnlace(ctx, w, token, "", ""); err != nil {
		t.Fatal(err)
	}
	ses := leer(w)
	if tiene, sin, _ := s.EstadoDeClave(ctx, ses); tiene || !sin {
		t.Errorf("sin clave: tiene=%v sinLaActual=%v", tiene, sin)
	}
	if err := s.CambiarClave(ctx, ses, "", "la primera clave"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Entrar(ctx, httptest.NewRecorder(), "ana@prueba.test", "la primera clave", "", "", true); err != nil {
		t.Fatalf("no entra con la clave que se puso: %v", err)
	}

	// Olvidó la clave: entra con un link y la cambia sin la actual, una vez.
	nombre, token, err := s.EnlaceDeIngreso(ctx, "ana@prueba.test")
	if err != nil || token == "" || nombre != "Ana" {
		t.Fatalf("link de ingreso: %q %v", token, err)
	}
	w = httptest.NewRecorder()
	if _, _, err := s.UsarEnlace(ctx, w, token, "", ""); err != nil {
		t.Fatal(err)
	}
	ses = leer(w)
	if tiene, sin, _ := s.EstadoDeClave(ctx, ses); !tiene || !sin {
		t.Errorf("después del link: tiene=%v sinLaActual=%v", tiene, sin)
	}
	if err := s.CambiarClave(ctx, ses, "", "la clave nueva"); err != nil {
		t.Fatal(err)
	}
	if err := s.CambiarClave(ctx, ses, "", "otra más"); !errors.Is(err, ErrCredenciales) {
		t.Errorf("la habilitación se usa una sola vez: %v", err)
	}

	// Entrando con clave, sin link, hay que dar la actual.
	w = httptest.NewRecorder()
	if _, err := s.Entrar(ctx, w, "ana@prueba.test", "la clave nueva", "", "", true); err != nil {
		t.Fatal(err)
	}
	if err := s.CambiarClave(ctx, leer(w), "", "sin la actual"); !errors.Is(err, ErrCredenciales) {
		t.Errorf("sin link pidió la actual: %v", err)
	}

	// Cambiar la clave anula los links pendientes; un link nuevo anula el anterior.
	_, viejo, _ := s.EnlaceDeIngreso(ctx, "ana@prueba.test")
	_, nuevo, _ := s.EnlaceDeIngreso(ctx, "ana@prueba.test")
	if _, _, err := s.UsarEnlace(ctx, httptest.NewRecorder(), viejo, "", ""); !errors.Is(err, ErrEnlaceInvalido) {
		t.Errorf("el link anterior sigue valiendo: %v", err)
	}
	if err := s.CambiarClave(ctx, leer(w), "la clave nueva", "la definitiva"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.UsarEnlace(ctx, httptest.NewRecorder(), nuevo, "", ""); !errors.Is(err, ErrEnlaceInvalido) {
		t.Errorf("el link pendiente sobrevivió al cambio de clave: %v", err)
	}

	// La limpieza borra los vencidos.
	_, _ = NuevoEnlace(ctx, pool, id, EnlaceIngreso, time.Minute, time.Now().Add(-time.Hour))
	if n, err := LimpiarEnlaces(ctx, pool); err != nil || n < 1 {
		t.Errorf("limpieza: %d %v", n, err)
	}
}
