package clientes

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/pruebas"
)

// M4-033: el mismo seguimiento abierto dos veces (un doble envío) no deja
// dos tarjetas; cerrado el primero, se puede abrir otro igual.
func TestSeguimientoNoSeDuplica(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('u-at', 'Atención', 'at@prueba.test', true, now(), now())`); err != nil {
		t.Fatal(err)
	}
	var cliente string
	if err := pool.QueryRow(ctx, `insert into customers (nombre) values ('Sim Constructora del Sur') returning id::text`).Scan(&cliente); err != nil {
		t.Fatal(err)
	}
	s := Nuevo(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ses := &auth.Sesion{UserID: "u-at"}
	if err := s.CrearGestion(ctx, ses, cliente, "Llamar por el saldo", "", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.CrearGestion(ctx, ses, cliente, " llamar por el saldo ", "", ""); err == nil {
		t.Fatal("la segunda igual entró")
	}
	if _, err := pool.Exec(ctx, `update customer_follow_ups set etapa = 'cerrado'`); err != nil {
		t.Fatal(err)
	}
	if err := s.CrearGestion(ctx, ses, cliente, "Llamar por el saldo", "", ""); err != nil {
		t.Fatalf("con la anterior cerrada: %v", err)
	}
}
