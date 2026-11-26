package mostrador

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// El presupuesto se trae a la venta por su número (mes simulado: eran doce
// clics en dos pantallas y el cobro no entraba en el turno). Al cobrar queda
// aceptado y atado al pedido, y no se vende dos veces.
func TestElPresupuestoSeTraeALaVenta(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	var quote string
	if err := e.pool.QueryRow(t.Context(), `insert into quotes (numero, contacto_nombre, estado, subtotal, total)
		values ('P-2026-0020', 'Valeria Torres', 'enviado', 90001, 90001) returning id::text`).Scan(&quote); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(t.Context(), `insert into quote_items (quote_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal)
		values ($1, $2, 'Fenólico 18 mm', 'placa', 2, 45000.5, 90001)`, quote, e.placa); err != nil {
		t.Fatal(err)
	}
	st, m, b := pedir(t, ven, "GET", e.u+"/api/v1/mostrador/presupuestos/p-2026-20", nil)
	if st != 200 || m["numero"] != "P-2026-0020" || !strings.Contains(b, `"cantidad":2`) {
		t.Fatalf("traer: %d %s", st, b)
	}
	v := e.venta("transferencia", e.lineaPlaca(2))
	v["presupuestoId"] = quote
	if st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); st != 200 || m["ok"] != true {
		t.Fatalf("cobrar: %d %s", st, b)
	}
	if s := e.txt(t, `select q.estado::text || ' ' || o.numero from quotes q join orders o on o.quote_id = q.id where q.id = $1`, quote); s != "aceptado PED-1000" {
		t.Errorf("presupuesto: %s", s)
	}
	if st, _, b := pedir(t, ven, "GET", e.u+"/api/v1/mostrador/presupuestos/P-2026-0020", nil); st != 422 || !strings.Contains(b, "ya se pasó al pedido PED-1000") {
		t.Errorf("otra vez: %d %s", st, b)
	}
	otra := e.venta("transferencia", e.lineaPlaca(2))
	otra["presupuestoId"] = quote
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", otra); m["ok"] == true || !strings.Contains(b, "ya se pasó") {
		t.Errorf("vendido dos veces: %s", b)
	}
}

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
	// Salió con el comprobante interno (el de siempre): queda guardado, y la
	// dueña lo distingue de una venta que se olvidó de facturar.
	if s := e.txt(t, `select coalesce(comprobante, '-') from orders where id = $1`, m["orderId"]); s != "interno" {
		t.Errorf("comprobante: %s", s)
	}
}
