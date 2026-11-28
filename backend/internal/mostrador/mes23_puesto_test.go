package mostrador

import (
	"context"
	"testing"

	"mjbj/internal/caja"
	"mjbj/internal/sqlc"
	"mjbj/internal/zodjs"
)

// Lo que encontró la prueba del mostrador en el navegador (mes 23, segunda
// vuelta).

// Defecto 1: la venta que cobra en Casa Central un corte del Aserradero pasa
// a la sucursal del corte (se retira allá), pero su efectivo entró al cajón
// de Casa Central. El Z y «Ventas de hoy» son de la caja que cobró: el
// Aserradero la sumaba en «Cobrado en el turno» sin que pasara por su cajón.
func TestMes23CorteDeOtraSucursalEnElZDeLaQueCobro(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1000)
	e.abrir(t, ven, e.otra, 2000)
	central := e.sesionAbierta(t)
	aserradero := e.txt(t, `select id::text from cash_sessions where branch_id = $1 and estado = 'abierta'`, e.otra)

	existente := e.txt(t, `insert into cutting_orders (numero, contacto_nombre, branch_id, variant_id, material_descripcion, placas, pasadas, estado)
		values ('CRT-90', 'Jorge Benítez', $1, $2, 'Fenólico 18 mm', 1, 0, 'terminado') returning id::text`, e.otra, e.placa)
	k := e.corteDePrueba(piezaDeCorte(1100, 800, 2))
	k["existente"] = existente
	e.svc.planoDelCorte(ctx, *leerCorte(zodjs.Raiz(aJSON(t, k))))
	v := e.venta("efectivo", e.renglonesDelCorte(t, 0, k, 0)...)
	v["cortes"] = []any{k}
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["ok"] != true {
		t.Fatalf("cobrar: %d %s", st, b)
	}
	pedido := m["orderId"].(string)
	// Se retira en el Aserradero, y la caja que cobró queda anotada.
	if got := e.txt(t, `select branch_id::text || ':' || coalesce(caja_branch_id::text, '-') from orders where id = $1`, pedido); got != e.otra+":"+e.central {
		t.Fatalf("sucursal y caja de la venta: %s", got)
	}
	total := e.num(t, `select total::float8 from orders where id = $1`, pedido)
	if got := e.num(t, `select coalesce(sum(monto), 0)::float8 from cash_movements where session_id = $1 and tipo = 'venta'`, central); got != total {
		t.Fatalf("el efectivo no entró a Casa Central: %v de %v", got, total)
	}

	// El Z de cada turno: la venta en Casa Central, nada en el Aserradero.
	efectivoDelZ := func(sesion string) float64 {
		t.Helper()
		z, err := caja.CierreDelTurno(ctx, e.pool, sesion)
		if err != nil {
			t.Fatal(err)
		}
		suma := 0.0
		for _, r := range z {
			if !r.Devolucion && !r.Cobranza && r.MedioPago == "efectivo" {
				suma += r.Total
			}
		}
		return suma
	}
	if got := efectivoDelZ(central); got != total {
		t.Errorf("Z de Casa Central: %v, tenía que ser %v", got, total)
	}
	if got := efectivoDelZ(aserradero); got != 0 {
		t.Errorf("Z del Aserradero sumó %v de una venta que no pasó por su cajón", got)
	}
	ventasDe := func(sucursal string) int {
		t.Helper()
		vs, err := caja.VentasDeHoy(ctx, e.pool, sucursal, e.svc.ahora())
		if err != nil {
			t.Fatal(err)
		}
		return len(vs)
	}
	if ventasDe(e.central) != 1 || ventasDe(e.otra) != 0 {
		t.Errorf("ventas de hoy: central %d, aserradero %d", ventasDe(e.central), ventasDe(e.otra))
	}

	// Anularla devuelve la plata desde el cajón que la cobró.
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	if st, m, b := pedir(t, adm, "POST", e.u+"/api/v1/mostrador/ventas/"+pedido+"/anular", map[string]any{"motivo": "Se equivocó"}); st != 200 || m["ok"] == nil {
		t.Fatalf("anular: %d %s", st, b)
	}
	if got := e.num(t, `select coalesce(sum(monto), 0)::float8 from cash_movements where session_id = $1 and tipo = 'devolucion'`, central); got != -total {
		t.Errorf("devolución en Casa Central: %v", got)
	}
	if got := e.num(t, `select count(*)::float8 from cash_movements where session_id = $1 and tipo = 'devolucion'`, aserradero); got != 0 {
		t.Errorf("la devolución salió del cajón del Aserradero")
	}
}

// M2S2-063: el chip de la caja avisa lo que cargó otra persona, medido contra
// quien está en la terminal y no contra quien abrió el turno. Con el turno
// abierto por el admin, el vendedor veía sus propias ventas como de otro.
func TestMes23ElChipEsContraQuienEstaEnLaTerminal(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, adm, e.central, 1000)
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", e.venta("efectivo", e.lineaPlaca(1))); m["ok"] != true {
		t.Fatalf("vender: %s", b)
	}
	sesion := e.sesionAbierta(t)
	admin := e.txt(t, `select id from "user" where email = 'admin@prueba.test'`)
	e.txt(t, `insert into cash_movements (session_id, tipo, monto, motivo, creado_por) values ($1, 'ingreso', 87900, 'Recibo REC-0019 — Taller Bosque', $2) returning id::text`, sesion, admin)

	_, p, b := pedir(t, ven, "GET", e.u+"/api/v1/mostrador/pantalla?sucursal="+e.central, nil)
	movs, _ := p["movimientos"].([]any)
	if len(movs) == 0 {
		t.Fatalf("pantalla: %s", b)
	}
	de := map[string]bool{}
	for _, x := range movs {
		mm := x.(map[string]any)
		if mm["otroPuesto"] == true {
			de[mm["tipo"].(string)] = true
		}
	}
	// Solo el recibo del admin: ni la venta propia ni la apertura.
	if !de["ingreso"] || de["venta"] || de["apertura"] {
		t.Errorf("de otra persona, para el vendedor: %v", de)
	}

	// En el panel sigue siendo contra quien abrió.
	movsPanel, err := caja.MovimientosDelTurno(context.Background(), e.pool, sesion)
	if err != nil {
		t.Fatal(err)
	}
	venta := false
	for _, m := range movsPanel {
		if m.Tipo == "venta" && m.OtroPuesto {
			venta = true
		}
	}
	if !venta {
		t.Errorf("en el panel, la venta del vendedor en el turno del admin no se marca")
	}
}
