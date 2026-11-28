package caja

import (
	"context"
	"testing"
	"time"
)

// M4-023: el efectivo de los recibos va en «Cobros», aparte del ingreso a
// mano. M4-109: la venta vendida y anulada en el mismo turno no figura en el
// Z ni como cobrada ni como devolución.
func TestCobrosAparteYAnuladaEnElTurno(t *testing.T) {
	e := armar(t)
	_, idAdm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	abre := time.Now().Add(-3 * time.Hour)
	turno := e.turno(t, e.central, idAdm, abre, nil, nil)
	for _, m := range []struct {
		tipo, motivo string
		monto        float64
	}{{"apertura", "", 10000}, {"ingreso", "Recibo REC-0004 — Sim Obra", 150000}, {"ingreso", "Cambio de la otra caja", 5000}} {
		var motivo *string
		if m.motivo != "" {
			motivo = &m.motivo
		}
		e.id(t, `insert into cash_movements (session_id, tipo, monto, motivo, created_at) values ($1, $2, $3, $4, $5) returning id`,
			turno, m.tipo, m.monto, motivo, abre.Add(time.Minute))
	}
	ab, err := Abierto(ctx, e.pool, e.central)
	if err != nil || ab == nil {
		t.Fatal(err)
	}
	if ab.Cobros != 150000 || ab.OtrosIngresos != 5000 {
		t.Errorf("cobros %v, otros ingresos %v", ab.Cobros, ab.OtrosIngresos)
	}

	vendida := abre.Add(time.Hour)
	e.venta(t, "PED-1040", e.central, "efectivo", 10000, vendida, &vendida, true)
	anulada := e.venta(t, "PED-1041", e.central, "efectivo", 8820, vendida, &vendida, true)
	if _, err := e.pool.Exec(ctx, `update orders set estado = 'cancelado' where id = $1`, anulada); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into order_status_history (order_id, estado, created_at) values ($1, 'cancelado', $2)`, anulada, vendida.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	z, err := CierresDeTurnos(ctx, e.pool, []string{turno})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range z[turno] {
		if r.Devolucion || (r.MedioPago == "efectivo" && !r.Cobranza && (r.Cantidad != 1 || r.Total != 10000)) {
			t.Errorf("la anulada del turno en el Z: %+v", z[turno])
		}
	}
}
