package whatsapp

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/pruebas"
)

func TestCrearFichaDesdeConversacion(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, Config{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	var conv string
	if err := pool.QueryRow(ctx, `insert into whatsapp_conversaciones (wa_jid) values ('5492235551234') returning id`).Scan(&conv); err != nil {
		t.Fatal(err)
	}
	ses := &auth.Sesion{UserID: "nadie", Nombre: "Ana"}
	if r, _ := s.CrearFicha(ctx, ses, conv, FormFicha{Nombre: "J"}); r.Error != "Escribí el nombre." {
		t.Errorf("nombre corto: %+v", r)
	}
	if r, _ := s.CrearFicha(ctx, ses, conv, FormFicha{Nombre: "Juan", Documento: "20-12345678-0"}); r.Error == "" {
		t.Errorf("CUIT inválido: %+v", r)
	}
	r, err := s.CrearFicha(ctx, ses, conv, FormFicha{Nombre: " Carpintería Sur ", Documento: "30-58944525-9", Email: " sur@prueba.test "})
	if err != nil || r.Ok != "Ficha de Carpintería Sur creada." {
		t.Fatalf("alta: %+v %v", r, err)
	}
	var nombre, cond, tel, email string
	_ = pool.QueryRow(ctx, `select c.nombre, c.condicion_iva::text, coalesce(c.telefono, ''), coalesce(c.email, '') from customers c
		join whatsapp_conversaciones w on w.customer_id = c.id where w.id = $1`, conv).Scan(&nombre, &cond, &tel, &email)
	if nombre != "Carpintería Sur" || cond != "responsable_inscripto" || tel == "" || email != "sur@prueba.test" {
		t.Errorf("ficha: %q %q %q %q", nombre, cond, tel, email)
	}
	if r, _ := s.CrearFicha(ctx, ses, conv, FormFicha{Nombre: "Otra"}); r.Error != "Esta conversación ya tiene ficha." {
		t.Errorf("dos veces: %+v", r)
	}
}
