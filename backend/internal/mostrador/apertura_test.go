package mostrador

import (
	"context"
	"fmt"
	"testing"

	"mjbj/internal/sqlc"
)

// El turno arranca con lo que quedó contado al cerrar el anterior (mes
// simulado, H024 y H249): abrir con otro fondo pide el motivo, y la
// diferencia queda a la vista como un retiro «entre turnos». Antes se abría
// con la base y la diferencia desaparecía sin un solo movimiento.
func TestElTurnoArrancaConLoContado(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)

	// El primer turno de la sucursal no tiene contra qué comparar.
	_, m, _ := pedir(t, ven, "GET", e.u+"/api/v1/mostrador/pantalla?sucursal="+e.central, nil)
	if m["ultimoContado"] != nil {
		t.Fatalf("sin turnos, nada contado: %v", m["ultimoContado"])
	}
	e.abrir(t, ven, e.central, 1500)
	sesion := e.txt(t, `select id::text from cash_sessions where estado = 'abierta'`)
	if st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/cerrar", map[string]any{"sessionId": sesion, "contado": 1600, "notas": "Sobró un billete"}); st != 200 {
		t.Fatalf("cerrar: %d %v %s", st, m, b)
	}
	_, m, _ = pedir(t, ven, "GET", e.u+"/api/v1/mostrador/pantalla?sucursal="+e.central, nil)
	if m["ultimoContado"] != 1600.0 {
		t.Fatalf("lo contado: %v", m["ultimoContado"])
	}

	// Abrir con la base sin decir adónde fue la diferencia: no.
	st, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/abrir", map[string]any{"branchId": e.central, "fondoInicial": 1000})
	if st != 422 || fmt.Sprint(m["errores"]) != "map[error:Al cerrar quedaron $ 1.600. Poné adónde fueron los $ 600.]" {
		t.Fatalf("sin motivo: %d %v", st, m)
	}
	// Con el motivo, y desde un puesto: la apertura es lo contado y la
	// diferencia, un retiro entre turnos.
	puesto := e.txt(t, `insert into pos_devices (codigo, branch_id, secreto) values ('CAJA2', $1, 's') returning id::text`, e.central)
	if st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/abrir", map[string]any{"branchId": e.central, "fondoInicial": 1000,
		"motivo": "Depósito en el banco", "cajaId": puesto}); st != 200 || m["ok"] != "Caja abierta." {
		t.Fatalf("con motivo: %d %v %s", st, m, b)
	}
	if s := e.txt(t, `select string_agg(tipo::text || ' ' || monto::text || ' ' || motivo, ' | ' order by tipo) from cash_movements m
		join cash_sessions s on s.id = m.session_id where s.estado = 'abierta'`); s != "apertura 1600.00 Quedó del turno anterior | retiro -600.00 Entre turnos: Depósito en el banco" {
		t.Errorf("movimientos: %s", s)
	}
	if c := e.txt(t, `select d.codigo from cash_sessions s join pos_devices d on d.id = s.pos_device_id where s.estado = 'abierta'`); c != "CAJA2" {
		t.Errorf("puesto: %s", c)
	}

	// Un gasto en efectivo cargado desde el panel sale del turno y se ve en
	// su recuadro (H366): los recuadros suman «Debería haber».
	if _, err := e.pool.Exec(ctx, `insert into cash_movements (session_id, tipo, monto, motivo) select id, 'gasto', -300, 'Flete' from cash_sessions where estado = 'abierta'`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into cash_movements (session_id, tipo, monto, motivo) select id, 'devolucion', -100, 'Anulación' from cash_sessions where estado = 'abierta'`); err != nil {
		t.Fatal(err)
	}
	_, m, _ = pedir(t, ven, "GET", e.u+"/api/v1/mostrador/pantalla?sucursal="+e.central, nil)
	tu := m["turno"].(map[string]any)
	suma := tu["fondoInicial"].(float64) + tu["ventasEnEfectivo"].(float64) + tu["otrosIngresos"].(float64) + tu["retiros"].(float64) +
		tu["devoluciones"].(float64) + tu["gastos"].(float64)
	if tu["gastos"] != -300.0 || tu["devoluciones"] != -100.0 || suma != tu["esperado"].(float64) || tu["esperado"] != 600.0 {
		t.Errorf("los recuadros no suman: %v", tu)
	}

	// Abrir con lo contado no pide nada.
	sesion = e.txt(t, `select id::text from cash_sessions where estado = 'abierta'`)
	if st, _, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/cerrar", map[string]any{"sessionId": sesion, "contado": 600, "notas": ""}); st != 200 {
		t.Fatalf("cerrar: %s", b)
	}
	if st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/caja/abrir", map[string]any{"branchId": e.central, "fondoInicial": 600.4}); st != 200 || m["ok"] == nil {
		t.Fatalf("con lo contado: %d %s", st, b)
	}
}
