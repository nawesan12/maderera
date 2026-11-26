package mostrador

import (
	"context"
	"testing"

	"mjbj/internal/sqlc"
	"mjbj/internal/zodjs"
)

// Un corte de la cola sin venta («paga al retirar») se cobra en el mostrador
// y queda atado a la venta, sin crear otro (mes simulado, H173).
func TestCobrarUnCorteDeLaCola(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	existente := e.txt(t, `insert into cutting_orders (numero, contacto_nombre, branch_id, variant_id, material_descripcion, placas, pasadas, estado, retira_el)
		values ('CRT-4', 'Jorge Benítez', $1, $2, 'Fenólico 18 mm', 1, 0, 'terminado', '2026-12-04') returning id::text`, e.central, e.placa)
	k := e.corteDePrueba(piezaDeCorte(1100, 800, 2))
	k["existente"] = existente
	c, _ := e.svc.planoDelCorte(ctx, *leerCorte(zodjs.Raiz(aJSON(t, k))))
	v := e.venta("transferencia", e.renglonesDelCorte(t, 0, k, 0)...)
	v["cortes"] = []any{k}
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["ok"] != true || c.Placas == 0 {
		t.Fatalf("cobrar el corte: %d %s", st, b)
	}
	if n := e.num(t, `select count(*)::float8 from cutting_orders`); n != 1 {
		t.Errorf("se creó otro corte: %v", n)
	}
	if o := e.txt(t, `select coalesce(order_id::text, '') from cutting_orders where id = $1`, existente); o != m["orderId"] {
		t.Errorf("el corte no quedó atado: %q", o)
	}
	// El pedido sabe qué día lo pasa a buscar (PED-1155).
	if d := e.txt(t, `select coalesce(to_char(entregar_el, 'YYYY-MM-DD'), '-') from orders where id = $1`, m["orderId"]); d != "2026-12-04" {
		t.Errorf("el pedido no hereda «Lo retira el»: %s", d)
	}

	// Ya atado, otra venta no lo vuelve a cobrar.
	v = e.venta("transferencia", e.renglonesDelCorte(t, 0, k, 0)...)
	v["cortes"] = []any{k}
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); m["ok"] != false {
		t.Errorf("se cobró dos veces: %s", b)
	}
}
