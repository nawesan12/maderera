package reportes

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"mjbj/internal/pruebas"
)

func TestListadosDelContador(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	ahora := time.Date(2026, 11, 18, 15, 0, 0, 0, time.UTC)
	var cli, prov string
	_ = pool.QueryRow(ctx, `insert into customers (nombre, cuit) values ('Obra Pérez', '20-12345678-9') returning id`).Scan(&cli)
	_, _ = pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, created_at) values
		($1, 'compra', 1000, '2026-07-01'), ($1, 'compra', 500, '2026-11-10'), ($1, 'pago', -300, '2026-11-12')`, cli)
	_ = pool.QueryRow(ctx, `insert into suppliers (nombre) values ('Faplac') returning id`).Scan(&prov)
	_, _ = pool.Exec(ctx, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, fecha_vencimiento, neto, iva21, total)
		values ($1, 'factura_a', 3, 41, '2026-10-01', '2026-10-31', 1000, 210, 1210)`, prov)

	s := Nuevo(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	d, err := s.CsvDeudores(ctx, ahora)
	if err != nil {
		t.Fatal(err)
	}
	// El pago de 300 cancela lo más viejo: quedan 700 de julio (más de 90) y 500 al día.
	if !strings.Contains(d, "Obra Pérez") || !strings.Contains(d, "500,00") || !strings.Contains(d, "700,00") || !strings.Contains(d, "1200,00") {
		t.Fatalf("deudores:\n%s", d)
	}
	c, err := s.CsvCuentasAPagar(ctx, ahora)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(c, "Faplac") || !strings.Contains(c, "Factura A 0003-00000041") || !strings.Contains(c, "31/10/2026") ||
		!strings.Contains(c, ";18;") || !strings.Contains(c, "1210,00") {
		t.Fatalf("cuentas a pagar:\n%s", c)
	}
}
