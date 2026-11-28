package entregas

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// M2S3-020 (mes 23): con el corte de vuelta en la máquina, el remito no
// ofrece lo que el corte se lleva: sale lo demás del renglón, sin cortar, y
// lo del corte espera a que se termine.
func TestElRemitoEsperaElCorte(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, _ := e.pedido(t, "PED-3021", "preparando", nil)
	e.exec(t, `update orders set estado_pago = 'pagado' where id = $1`, pedido)
	corte := e.uno(t, `insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado, variant_id, placas)
		values ('CRT-21', $1, 'Wood Frame', 'Tirante', 'en-proceso', $2, 3) returning id::text`, pedido, e.variante)

	_, b := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/pedidos/"+pedido+"/acopio", nil)
	if !strings.Contains(b, `"enCorte":"CRT-21"`) || !strings.Contains(b, `"enCorteCantidad":3`) {
		t.Fatalf("el acopio no dice el corte: %s", b)
	}
	u := e.srv.URL + "/api/v1/admin/remitos"
	retirar := func(n string) (int, string) {
		t.Helper()
		return pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "20111222", "cantidades": cantidades(r1, n)})
	}
	if c, b := retirar("8"); c != 422 || !strings.Contains(b, "espera el corte CRT-21") {
		t.Fatalf("salió lo del corte: %d %s", c, b)
	}
	if c, b := retirar("7"); c != 200 {
		t.Fatalf("lo que no se corta: %d %s", c, b)
	}
	if c, b := retirar("1"); c != 422 || !strings.Contains(b, "espera el corte CRT-21") {
		t.Fatalf("salió lo del corte después: %d %s", c, b)
	}
	e.exec(t, `update cutting_orders set estado = 'terminado', terminado_at = now() where id = $1`, corte)
	if c, b := retirar("3"); c != 200 {
		t.Fatalf("con el corte terminado: %d %s", c, b)
	}
}
