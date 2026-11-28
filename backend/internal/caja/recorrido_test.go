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

// Recorrido 2, M4-109: los recuadros del turno tampoco la cuentan. En
// producción el turno abierto y el Z cerrado decían «Ventas en efectivo
// $ 16.020» y «Devoluciones −$ 8.010» al lado de «Efectivo (1) $ 8.010».
// «Debería haber» no cambia: la plata entró y salió del cajón.
func TestLosRecuadrosNoCuentanLaAnuladaEnElTurno(t *testing.T) {
	e := armar(t)
	_, idAdm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	abre := time.Now().Add(-3 * time.Hour)
	turno := e.turno(t, e.central, idAdm, abre, nil, nil)
	vendida := abre.Add(time.Hour)
	buena := e.venta(t, "PED-1042", e.central, "efectivo", 8010, vendida, &vendida, true)
	anulada := e.venta(t, "PED-1043", e.central, "efectivo", 8010, vendida, &vendida, true)
	movs := []struct {
		tipo   string
		monto  float64
		pedido *string
	}{{"apertura", 10000, nil}, {"venta", 8010, &buena}, {"venta", 8010, &anulada}, {"devolucion", -8010, &anulada}}
	for i, m := range movs {
		e.id(t, `insert into cash_movements (session_id, tipo, monto, order_id, created_at) values ($1, $2, $3, $4, $5) returning id`,
			turno, m.tipo, m.monto, m.pedido, abre.Add(time.Duration(i+1)*time.Minute+time.Hour))
	}
	if _, err := e.pool.Exec(ctx, `update orders set estado = 'cancelado' where id = $1`, anulada); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into order_status_history (order_id, estado, created_at) values ($1, 'cancelado', $2)`, anulada, vendida.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}

	ab, err := Abierto(ctx, e.pool, e.central)
	if err != nil || ab == nil {
		t.Fatal(err)
	}
	if ab.VentasEnEfectivo != 8010 || ab.Devoluciones != 0 || ab.CantidadDeVentas != 1 || ab.Esperado != 18010 {
		t.Errorf("abierto: ventas %v (8.010), devoluciones %v (0), cantidad %d, debería haber %v (18.010)",
			ab.VentasEnEfectivo, ab.Devoluciones, ab.CantidadDeVentas, ab.Esperado)
	}

	cierra := time.Now()
	if _, err := e.pool.Exec(ctx, `update cash_sessions set estado = 'cerrada', cerrada_at = $2, contado = 18010 where id = $1`, turno, cierra); err != nil {
		t.Fatal(err)
	}
	cerrados, err := turnosCerrados(ctx, e.pool, "s.id = $1", "", turno)
	if err != nil || len(cerrados) != 1 {
		t.Fatal(err, cerrados)
	}
	c := cerrados[0]
	if c.Ventas != 8010 || c.Devoluciones != 0 || c.Esperado != 18010 {
		t.Errorf("cerrado: ventas %v (8.010), devoluciones %v (0), debería haber %v (18.010)", c.Ventas, c.Devoluciones, c.Esperado)
	}
}
