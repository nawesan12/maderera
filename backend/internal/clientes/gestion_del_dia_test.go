package clientes

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"mjbj/internal/pruebas"
)

// Mes 23, tercera prueba: la gestión con «Volver el» de hoy es para hoy
// hasta la medianoche argentina, no vencida desde el mediodía (a las 21 h,
// con el día UTC ya en el siguiente, se leía «Vencía el 27/11»). La de ayer
// sí está vencida, y el «Para hoy» del inicio cuenta las dos.
func TestGestionDeHoyNoEstaVencida(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	var cliente string
	if err := pool.QueryRow(ctx, `insert into customers (nombre) values ('Sim Obra') returning id::text`).Scan(&cliente); err != nil {
		t.Fatal(err)
	}
	// 27/11 a las 21:30 argentinas: ya es 28/11 en UTC.
	ahora := time.Date(2026, 11, 27, 21, 30, 0, 0, argentina)
	for _, g := range []struct{ asunto, dia string }{{"De hoy", "2026-11-27"}, {"De ayer", "2026-11-26"}, {"De mañana", "2026-11-28"}} {
		cuando, err := mediodia(g.dia)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `insert into customer_follow_ups (customer_id, asunto, proxima_accion_at) values ($1, $2, $3)`, cliente, g.asunto, cuando); err != nil {
			t.Fatal(err)
		}
	}
	s := Nuevo(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	gs, err := s.Gestiones(ctx, false, "", ahora)
	if err != nil {
		t.Fatal(err)
	}
	quiero := map[string][2]bool{"De hoy": {false, true}, "De ayer": {true, false}, "De mañana": {false, false}}
	for _, g := range gs {
		if q := quiero[g.Asunto]; g.Vencida != q[0] || g.ParaHoy != q[1] {
			t.Errorf("%s: vencida %v, para hoy %v", g.Asunto, g.Vencida, g.ParaHoy)
		}
	}
	// A las 9 de la mañana la de hoy ya cuenta para el inicio, igual que a
	// las 21.
	for _, h := range []int{9, 21} {
		n, err := s.GestionesVencidas(ctx, time.Date(2026, 11, 27, h, 30, 0, 0, argentina))
		if err != nil {
			t.Fatal(err)
		}
		if n != 2 {
			t.Errorf("a las %d, para hoy o vencidas: %d", h, n)
		}
	}
}
