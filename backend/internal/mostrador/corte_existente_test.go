package mostrador

import (
	"context"
	"strings"
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
	// El corte ya está terminado: el pedido nace listo para entregar, no
	// en «Preparando» (M3S4-040).
	if est := e.txt(t, `select estado::text from orders where id = $1`, m["orderId"]); est != "listo" {
		t.Errorf("el pedido de un corte terminado quedó %s", est)
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

// Ítem 9 del mes simulado: con comprobante fiscal, un CUIT mal tipeado frena
// la venta antes de cobrarla; antes quedaba registrada sin comprobante.
func TestElCuitDelComprobanteSeRevisaAntes(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 0)
	v := e.venta("efectivo", e.lineaPlaca(1))
	v["comprobante"] = "fiscal"
	v["contactoNombre"] = "Carpintería Prueba"
	v["cuit"] = "30-71234567-8"
	_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if m["ok"] != false || !strings.Contains(b, "El CUIT no es válido") {
		t.Fatalf("venta con un CUIT mal tipeado: %s", b)
	}
	if n := e.num(t, `select count(*)::float8 from orders`); n != 0 {
		t.Errorf("la venta quedó registrada: %v", n)
	}
	v["cuit"] = "30-71234567-1"
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); m["ok"] != true {
		t.Errorf("con el CUIT bien: %s", b)
	}
}

// Tercera prueba, CRT-7302: el corte de la cola se cobra con las pasadas que
// confirmó el taller (las de su ficha), no con las del plano. Con el
// despiece cambiado, manda el plano.
func TestElCorteDeLaColaCobraSusPasadas(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	k := e.corteDePrueba(piezaDeCorte(500, 300, 2))
	plano, _ := e.svc.planoDelCorte(ctx, *leerCorte(zodjs.Raiz(aJSON(t, k))))
	if plano.Pasadas == 0 {
		t.Fatal("el plano de prueba no tiene pasadas")
	}
	existente := e.txt(t, `insert into cutting_orders (numero, contacto_nombre, branch_id, variant_id, material_descripcion, placas, pasadas, estado)
		values ('CRT-7302', 'Jorge Benítez', $1, $2, 'Fenólico 18 mm', 1, $3, 'terminado') returning id::text`, e.central, e.placa, plano.Pasadas+3)
	e.exec(t, `insert into cutting_items (cutting_order_id, largo_mm, ancho_mm, cantidad, respeta_veta, orden) values ($1, 500, 300, 2, 0, 0)`, existente)
	k["existente"] = existente
	if c, _ := e.svc.planoDelCorte(ctx, *leerCorte(zodjs.Raiz(aJSON(t, k)))); c.Pasadas != plano.Pasadas+3 {
		t.Errorf("pasadas del corte de la cola: %d, quiero %d", c.Pasadas, plano.Pasadas+3)
	}
	otro := e.corteDePrueba(piezaDeCorte(500, 250, 2))
	otro["existente"] = existente
	solo := e.corteDePrueba(piezaDeCorte(500, 250, 2))
	a, _ := e.svc.planoDelCorte(ctx, *leerCorte(zodjs.Raiz(aJSON(t, otro))))
	b, _ := e.svc.planoDelCorte(ctx, *leerCorte(zodjs.Raiz(aJSON(t, solo))))
	if a.Pasadas != b.Pasadas {
		t.Errorf("con otro despiece manda el plano: %d, quiero %d", a.Pasadas, b.Pasadas)
	}
}
