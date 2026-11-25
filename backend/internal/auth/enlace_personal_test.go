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

// Un link de activación emitido a un cliente no sirve si la cuenta pasó a
// ser del personal mientras estaba vigente: el personal entra con clave.
func TestEnlaceDeQuienPasoAlPersonal(t *testing.T) {
	g := leerGolden(t)
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := servicio(t, pool, g, "http://localhost:3100")
	id, err := CrearCuentaSinClave(ctx, sqlc.New(pool), "Ana", "ana@prueba.test", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	token, _ := NuevoEnlace(ctx, pool, id, EnlaceActivacion, VenceActivacion, time.Now())
	if _, err := pool.Exec(ctx, `update profiles set role = 'staff', staff_role = 'admin' where user_id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.UsarEnlace(ctx, httptest.NewRecorder(), token, "", ""); !errors.Is(err, ErrEnlaceInvalido) {
		t.Fatalf("el link abrió una sesión del personal: %v", err)
	}
}
