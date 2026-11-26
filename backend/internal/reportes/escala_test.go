package reportes

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/pruebas"
)

// Tanda T8: los márgenes agrupan solo los renglones de los pedidos del
// reporte, y el inicio ya no recorre orders entera.

// Un pedido sin renglones suma su total y nada de neto ni costo, y uno fuera
// del período no suma nada: los mismos números que daba agrupar order_items
// entero.
func TestMargenesSoloDelPeriodo(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, silencio)
	desde := time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC)
	hasta := time.Date(2026, 11, 1, 3, 0, 0, 0, time.UTC)
	var conRenglones, viejo string
	if err := pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, total, created_at, estado)
		values ('A', 'Ana', 1210, '2026-10-10', 'entregado') returning id`).Scan(&conRenglones); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into orders (numero, contacto_nombre, total, created_at, estado)
		values ('B', 'Beto', 300, '2026-10-11', 'entregado')`); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, total, created_at, estado)
		values ('C', 'Viejo', 999, '2026-09-10', 'entregado') returning id`).Scan(&viejo); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into order_items (order_id, descripcion, cantidad, precio_unitario, subtotal, costo_unitario, alicuota_iva)
		values ($1, 'placa', 1, 1210, 1210, 500, 21), ($2, 'vieja', 1, 999, 999, null, 21)`, conRenglones, viejo); err != nil {
		t.Fatal(err)
	}

	r, err := s.ResultadoEntre(ctx, desde, hasta, desde, hasta)
	if err != nil {
		t.Fatal(err)
	}
	if r.VentasNetas != 1000 || r.Costo != 500 || r.LineasSinCosto != 0 {
		t.Errorf("resultado: %+v", r)
	}
	rep, err := s.ReporteDeVentas(ctx, "canal", Periodo{Desde: &desde, Hasta: &hasta}, Filtros{})
	if err != nil {
		t.Fatal(err)
	}
	filas := rep.Filas
	if len(filas) != 1 || filas[0].Cantidad != 2 || filas[0].Total != 1510 || filas[0].NetoVenta != 1000 ||
		filas[0].Costo == nil || *filas[0].Costo != 500 || filas[0].LineasSinCosto != 0 {
		t.Errorf("por canal: %+v", filas)
	}
}

// Los pedidos sin entregar del inicio salen del índice parcial y las ventas
// se acotan al período: nada de recorrer orders entera.
func TestElInicioNoRecorreLosPedidos(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (numero, contacto_nombre, origen, estado, total, created_at)
		SELECT 'X-' || i, 'c', 'mostrador', CASE WHEN i % 500 = 0 THEN 'pendiente' ELSE 'entregado' END::estado_pedido, 100,
		       now() - (i || ' hours')::interval
		FROM generate_series(1, 30000) i;
		ANALYZE orders`); err != nil {
		t.Fatal(err)
	}
	s := Nuevo(pool, silencio)
	desde := time.Now().AddDate(0, -1, 0)
	antes := desde.AddDate(0, -1, 0)
	ahora := time.Now()
	p := Periodo{Desde: &desde, Hasta: &ahora, AnteriorDesde: &antes, AnteriorHasta: &desde}
	m, err := s.MetricasDelResumen(ctx, p)
	if err != nil {
		t.Fatal(err)
	}
	if m.PedidosSinEntregar != 60 {
		t.Errorf("sin entregar: %d", m.PedidosSinEntregar)
	}
	// El plan de la misma consulta, con los mismos argumentos.
	filas, err := pool.Query(ctx, "EXPLAIN "+consultaDeMetricas, p.Desde, p.Hasta, p.AnteriorDesde, p.AnteriorHasta)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	texto := strings.Join(plan, "\n")
	if strings.Contains(texto, "Seq Scan on orders") {
		t.Errorf("el inicio recorre orders:\n%s", texto)
	}
}
