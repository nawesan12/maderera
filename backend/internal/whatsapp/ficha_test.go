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
	var vendedora string
	if err := pool.QueryRow(ctx, `insert into sellers (nombre) values ('Ána') returning id`).Scan(&vendedora); err != nil {
		t.Fatal(err)
	}
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
	var nombre, cond, tel, email, vendedor string
	_ = pool.QueryRow(ctx, `select c.nombre, c.condicion_iva::text, coalesce(c.telefono, ''), coalesce(c.email, ''), coalesce(c.seller_id::text, '') from customers c
		join whatsapp_conversaciones w on w.customer_id = c.id where w.id = $1`, conv).Scan(&nombre, &cond, &tel, &email, &vendedor)
	// El teléfono como las demás fichas y quien la creó de vendedora (M2S3-071).
	if nombre != "Carpintería Sur" || cond != "responsable_inscripto" || tel != "223 555-1234" || email != "sur@prueba.test" || vendedor != vendedora {
		t.Errorf("ficha: %q %q %q %q %q", nombre, cond, tel, email, vendedor)
	}
	if r, _ := s.CrearFicha(ctx, ses, conv, FormFicha{Nombre: "Otra"}); r.Error != "Esta conversación ya tiene ficha." {
		t.Errorf("dos veces: %+v", r)
	}
}
