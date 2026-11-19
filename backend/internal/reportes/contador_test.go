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
	factura := func(cliente, pedido *string, numero int, total float64, cuando string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado,
			fecha_emision, cae, customer_id, order_id) values ('factura_b', 3, $1, 'Receptor', $2, 0, 0, 0, 0, $2, 'autorizada', $3, '7612', $4, $5)`,
			numero, total, cuando, cliente, pedido); err != nil {
			t.Fatal(err)
		}
	}
	// Las facturas de Obra Pérez (julio y noviembre) y un recibo de 300 con
	// su reparto a Deudores.
	factura(&cli, nil, 1, 1000, "2026-07-01T15:00:00Z")
	factura(&cli, nil, 2, 500, "2026-11-10T15:00:00Z")
	_, _ = pool.Exec(ctx, `insert into receipts (numero, customer_id, recibido_de, total, origen, created_at, reparto_deudores, reparto_anticipo, reparto_b)
		values ('REC-1', $1, 'Obra Pérez', 300, 'panel', '2026-11-12T15:00:00Z', 300, 0, 0)`, cli)
	// La venta sin factura a cuenta corriente es deuda del circuito B: no
	// va al listado que se concilia con 1.1.03.
	_, _ = pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, created_at) values ($1, 'compra', 9999, '2026-11-01')`, cli)
	// Dado de baja, pero todavía debe: tiene que figurar.
	var baja string
	_ = pool.QueryRow(ctx, `insert into customers (nombre, active) values ('Dado de Baja', false) returning id`).Scan(&baja)
	factura(&baja, nil, 3, 4321, "2026-11-01T15:00:00Z")
	// Un pedido sin cliente facturado y sin cobrar: figura con su contacto.
	var sucursal, pedido string
	_ = pool.QueryRow(ctx, `insert into branches (slug, name) values ('central', 'Central') returning id`).Scan(&sucursal)
	_ = pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, branch_id, origen, total) values ('PED-9', 'Juan del Pedido', $1, 'presupuesto', 777)
		returning id`, sucursal).Scan(&pedido)
	factura(nil, &pedido, 4, 777, "2026-11-02T15:00:00Z")
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
	if !strings.Contains(d, "Dado de Baja") || !strings.Contains(d, "4321,00") {
		t.Fatalf("el dado de baja que debe no está:\n%s", d)
	}
	if strings.Contains(d, "9999") || strings.Contains(d, "11199") {
		t.Fatalf("la deuda del B en el listado del estudio:\n%s", d)
	}
	if !strings.Contains(d, "Juan del Pedido") || !strings.Contains(d, "PED-9") || !strings.Contains(d, "777,00") {
		t.Fatalf("el pedido sin cliente facturado no está:\n%s", d)
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
