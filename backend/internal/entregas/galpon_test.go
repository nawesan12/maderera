package entregas

import (
	"testing"

	"mjbj/internal/sqlc"
)

// Mes simulado, H218: quien arma el remito ve lo que hay en el galpón de cada
// renglón. Con más vendido que lo que hay, se ve antes de prometer la entrega.
// Lo que ya salió en el camión de otro pedido en camino no está en el estante.
func TestElAcopioDiceLoQueHayEnElGalpon(t *testing.T) {
	e := armar(t)
	dep, _ := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	pedido, _, _ := e.pedido(t, "PED-1050", "listo", nil)
	otro, _, _ := e.pedido(t, "PED-1008", "listo", nil)
	e.exec(t, `update orders set estado = 'en-camino' where id = $1`, otro)
	e.exec(t, `update inventory set qty = 12 where variant_id = $1`, e.variante)
	_, b := pedir(t, dep, "GET", e.srv.URL+"/api/v1/admin/pedidos/"+pedido+"/acopio", nil)
	acopio := leer[[]Renglon](t, b)
	// Tirante 2x4: 12 en el sistema, 10 en el camión de PED-1008 → 2.
	if len(acopio) != 2 || acopio[0].EnElGalpon == nil || *acopio[0].EnElGalpon != 2 || acopio[1].EnElGalpon == nil || *acopio[1].EnElGalpon != 96 {
		t.Fatalf("galpón: %s", b)
	}
	// Con un remito de envío vivo, lo reservado de PED-1008 es lo que falta
	// llevar y está en el estante (H166): el galpón vuelve a 12.
	e.exec(t, `insert into deliveries (numero, order_id, tipo, estado) values ('REM-0011', $1, 'envio', 'preparada')`, otro)
	_, b = pedir(t, dep, "GET", e.srv.URL+"/api/v1/admin/pedidos/"+pedido+"/acopio", nil)
	if acopio = leer[[]Renglon](t, b); *acopio[0].EnElGalpon != 12 {
		t.Fatalf("galpón con remito: %s", b)
	}
}
