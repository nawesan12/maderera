package clientes

import (
	"context"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/pruebas"
)

// M2S1-097: invitar al portal a un cliente del panel le abre la cuenta con
// el correo de la ficha y la ata; sin correo, o con uno que ya tiene cuenta,
// no.
func TestInvitarAlPortal(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, silencio)
	ses := &auth.Sesion{UserID: "nadie", Nombre: "Vendedora"}
	var conCorreo, sinCorreo string
	_ = pool.QueryRow(ctx, `insert into customers (nombre, email) values ('Sim Rocío Navarro', 'Sim.Rocio@Ejemplo.test') returning id`).Scan(&conCorreo)
	_ = pool.QueryRow(ctx, `insert into customers (nombre) values ('Sin correo') returning id`).Scan(&sinCorreo)

	if _, err := s.InvitarAlPortal(ctx, ses, sinCorreo); err == nil {
		t.Fatal("sin correo, se invitó")
	}
	inv, err := s.InvitarAlPortal(ctx, ses, conCorreo)
	if err != nil || inv.Token == "" || inv.Correo != "sim.rocio@ejemplo.test" {
		t.Fatalf("invitación: %+v %v", inv, err)
	}
	var atada bool
	if err := pool.QueryRow(ctx, `select c.user_id = u.id from customers c join "user" u on u.email = 'sim.rocio@ejemplo.test' where c.id = $1`, conCorreo).Scan(&atada); err != nil || !atada {
		t.Fatalf("la cuenta no quedó atada a la ficha: %v", err)
	}
	if _, err := s.InvitarAlPortal(ctx, ses, conCorreo); err == nil {
		t.Error("dos veces: ya tiene cuenta")
	}
}
