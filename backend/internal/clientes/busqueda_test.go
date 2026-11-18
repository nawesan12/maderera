package clientes

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"mjbj/internal/pruebas"
)

// El teléfono y el CUIT se encuentran escritos como sea: se comparan los
// dígitos. Antes «2235551234» no encontraba «223 555-1234».
func TestBuscarPorTelefonoYCuit(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `insert into customers (nombre, telefono, cuit) values
		('Juan Pérez', '223 555-1234', '20-12345678-9'), ('Ana Gómez', '(0223) 15 444-9999', null)`); err != nil {
		t.Fatal(err)
	}
	s := Nuevo(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, busco := range []string{"2235551234", "+54 9 223 555 1234", "20123456789", "555-1234", "Pérez"} {
		cs, err := s.Listar(ctx, FiltrosDeClientes{Busqueda: busco}, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		if len(cs.AlDia) != 1 || cs.AlDia[0].Nombre != "Juan Pérez" || cs.TotalAlDia != 1 {
			t.Errorf("%q: %+v", busco, cs)
		}
	}
}
