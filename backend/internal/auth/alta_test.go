package auth

import (
	"context"
	"testing"

	"mjbj/internal/pruebas"
)

// La ficha que crea el alta de una cuenta sin ficha no lleva nota (comité
// final): decía «Cuenta creada con cliente:create.», el nombre del comando
// del sistema viejo, y era lo primero que se leía en la ficha del cliente.
func TestElAltaDeClienteNoDejaNota(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(Config{Secreto: "secreto-de-prueba-del-alta-de-32-caracteres", URL: "http://localhost"}, pool)
	if _, err := s.AltaDeCliente(ctx, "nueva@cliente.test", "una clave larga", "Nueva"); err != nil {
		t.Fatal(err)
	}
	var notas *string
	if err := pool.QueryRow(ctx, `SELECT notas FROM customers WHERE email = 'nueva@cliente.test'`).Scan(&notas); err != nil {
		t.Fatal(err)
	}
	if notas != nil {
		t.Errorf("la ficha nueva dice %q", *notas)
	}
}
