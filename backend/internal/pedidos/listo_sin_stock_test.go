package pedidos

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Mes simulado, H218: «Marcar listo» es armado, y no se arma lo que no está en
// el galpón. El tablero lo ofrecía con 135 placas vendidas y 55 en el estante.
func TestNoSeArmaLoQueNoHay(t *testing.T) {
	e := armar(t)
	dep, ses := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	pedido := e.pedido(t, ses, 30)
	e.exec(t, `update orders set estado = 'preparando' where id = $1`, pedido)
	e.exec(t, `update inventory set qty = 20 where variant_id = $1`, e.placa)
	u := e.srv.URL + "/api/v1/admin/pedidos/" + pedido + "/avanzar?desde=preparando"
	if c, b := pedir(t, dep, "POST", u, nil); c != 422 || !strings.Contains(b, "lleva 30 y en el galpón hay 20") {
		t.Fatalf("sin stock: %d %s", c, b)
	}
	if s := e.texto(t, `select estado::text from orders where id = $1`, pedido); s != "preparando" {
		t.Fatalf("avanzó igual: %s", s)
	}
	e.exec(t, `update inventory set qty = 30 where variant_id = $1`, e.placa)
	if c, b := pedir(t, dep, "POST", u, nil); c != 200 {
		t.Fatalf("con stock: %d %s", c, b)
	}
}
