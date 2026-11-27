package vivo

import (
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// M3S3-045: acreditar o rechazar un cobro avisa a Cobranzas (canal
// «cobros», del admin) y cancelar un pedido avisa a la lista de Pedidos
// («estado_pedidos»): antes solo salían los del taller.
func TestCobrosYEstadoDePedidosEnVivo(t *testing.T) {
	pool := pruebas.Base(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c := Nueva(pool.Config().ConnString(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	go c.Correr(ctx)
	admin := httptest.NewServer(conRol(c, sqlc.StaffRoleAdmin))
	defer admin.Close()
	resultado := make(chan []string, 1)
	go func() { resultado <- leerEventos(t, admin.URL, 2, 5*time.Second) }()
	time.Sleep(500 * time.Millisecond)
	var cliente, pedido string
	if err := pool.QueryRow(ctx, `insert into customers (nombre, tipo) values ('Sur', 'particular') returning id`).Scan(&cliente); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into payments (customer_id, tipo, proveedor, medio, monto, estado) values ($1, 'deuda', 'transferencia', 'deposito', 100, 'en_revision')`, cliente); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, origen, estado, total) values ('PED-1', 'X', 'mostrador', 'pendiente', 100) returning id`).Scan(&pedido); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `update orders set estado = 'cancelado' where id = $1`, pedido); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(<-resultado, ","); got != "cobros,estado_pedidos" {
		t.Errorf("eventos: %q", got)
	}
}
