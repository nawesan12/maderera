package mostrador

import (
	"testing"

	"mjbj/internal/sqlc"
)

// La venta con un corte queda en curso hasta que las piezas salen de la
// máquina, con su alta en el historial (mes simulado: quedaba «entregado»
// con el corte en cola, y el historial de la ficha vacío).
func TestLaVentaConCorteQuedaEnCurso(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	k := e.corteDePrueba(piezaDeCorte(1100, 800, 2))
	v := e.venta("transferencia", e.renglonesDelCorte(t, 0, k, 0)...)
	v["cortes"] = []any{k}
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["ok"] != true {
		t.Fatalf("venta: %d %s", st, b)
	}
	if s := e.txt(t, `select estado::text from orders where id = $1`, m["orderId"]); s != "preparando" {
		t.Errorf("la venta con corte quedó %s", s)
	}
	if s := e.txt(t, `select string_agg(estado::text || ':' || nota, ',') from order_status_history where order_id = $1`, m["orderId"]); s != "preparando:Venta de mostrador" {
		t.Errorf("historial: %s", s)
	}
}
