package precios

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"mjbj/internal/auth"
)

// M2S2-030: una oferta con el precio de antes y hasta cuándo; al vencer, el
// precio vuelve solo, y un precio cargado a mano la termina.
func TestOfertaDeUnProducto(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	s := Nuevo(e.pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ses := &auth.Sesion{UserID: "nadie"}
	ahora := time.Now()
	hoy := ahora.In(zonaArgentina).Format("2006-01-02")
	antes := e.precio(t, e.fen18, e.general)

	if err := s.Ofertar(ctx, ses, e.fen18, e.general, "999999999", hoy, ahora); err == nil {
		t.Fatal("una oferta más cara que el precio se aceptó")
	}
	if err := s.Ofertar(ctx, ses, e.fen18, e.general, "70000", ahora.AddDate(0, 0, -1).In(zonaArgentina).Format("2006-01-02"), ahora); err == nil {
		t.Fatal("una oferta que ya terminó se aceptó")
	}
	if err := s.Ofertar(ctx, ses, e.fen18, e.general, "70000", hoy, ahora); err != nil {
		t.Fatal(err)
	}
	if p := e.precio(t, e.fen18, e.general); p != "70000.00" {
		t.Fatalf("precio de oferta: %s", p)
	}
	var anterior string
	_ = e.pool.QueryRow(ctx, `select precio_anterior::text from price_list_items where variant_id = $1 and price_list_id = $2`, e.fen18, e.general).Scan(&anterior)
	if anterior != antes {
		t.Fatalf("precio de antes: %s, quería %s", anterior, antes)
	}

	// Venció: vuelve al de antes.
	if _, err := e.pool.Exec(ctx, `update price_list_items set oferta_hasta = now() - interval '1 minute' where variant_id = $1 and price_list_id = $2`, e.fen18, e.general); err != nil {
		t.Fatal(err)
	}
	if n, err := s.VencerOfertas(ctx); err != nil || n != 1 {
		t.Fatalf("vencer: %d %v", n, err)
	}
	if p := e.precio(t, e.fen18, e.general); p != antes {
		t.Fatalf("al vencer quedó %s, quería %s", p, antes)
	}

	// Un precio a mano termina la oferta: al vencer no pisa el nuevo.
	if err := s.Ofertar(ctx, ses, e.fen18, e.general, "70000", hoy, ahora); err != nil {
		t.Fatal(err)
	}
	if err := s.Editar(ctx, ses, e.fen18, e.general, "88000"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `update price_list_items set oferta_hasta = now() - interval '1 minute' where variant_id = $1 and price_list_id = $2 and oferta_hasta is not null`, e.fen18, e.general); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.VencerOfertas(ctx); n != 0 {
		t.Fatalf("una oferta terminada a mano volvió: %d", n)
	}
	if p := e.precio(t, e.fen18, e.general); p != "88000.00" {
		t.Fatalf("quedó %s", p)
	}
}
