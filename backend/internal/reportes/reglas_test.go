package reportes

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"mjbj/internal/pruebas"
)

// La ganancia sigue las dos reglas del dueño: el descuento del pedido sale de
// las ventas, y los gastos atados a una factura de compra entran sin IVA.
func TestGananciaSegunLasReglas(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	var pedido, proveedor, factura string
	_ = pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, subtotal, descuento, total)
		values ('PED-R1', 'Juan', 1210, 121, 1089) returning id`).Scan(&pedido)
	exec(`insert into order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal, alicuota_iva, costo_unitario)
		values ($1, 'Placa', 'unidad', 1, 1210, 1210, 21, 500)`, pedido)
	_ = pool.QueryRow(ctx, `insert into suppliers (nombre) values ('Flete SA') returning id`).Scan(&proveedor)
	_ = pool.QueryRow(ctx, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, total)
		values ($1, 'factura_a', 1, 1, current_date, 100, 21, 121) returning id`, proveedor).Scan(&factura)
	exec(`insert into expenses (fecha, categoria, descripcion, importe, medio, purchase_invoice_id)
		values (current_date, 'flete', 'Flete', 121, 'efectivo', $1)`, factura)

	s := Nuevo(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	desde := time.Now().AddDate(0, 0, -1)
	hasta := time.Now().AddDate(0, 0, 1)
	// El día en UTC: de 21 a 24 h de Argentina, el día local ya no es el
	// current_date de la base y el gasto de hoy quedaba afuera del rango.
	dia := func(t time.Time) time.Time {
		t = t.UTC()
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	}

	r, err := s.ResultadoEntre(ctx, desde, hasta, dia(desde), dia(hasta))
	if err != nil {
		t.Fatal(err)
	}
	if r.VentasNetas != 1000 || r.Gastos != 121 || r.Resultado != 379 {
		t.Fatalf("como siempre: %+v", r)
	}

	exec(`update site_settings set valor = 'sin_iva' where clave = 'ganancia_gastos'`)
	exec(`update site_settings set valor = 'si' where clave = 'ganancia_descuento'`)
	r, _ = s.ResultadoEntre(ctx, desde, hasta, dia(desde), dia(hasta))
	if r.VentasNetas != 900 || r.Gastos != 100 || r.Resultado != 300 {
		t.Fatalf("con las reglas: %+v", r)
	}
}
