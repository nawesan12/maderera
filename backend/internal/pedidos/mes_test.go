package pedidos

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Lo que encontró el mes simulado en producción (26/11/2026) en el tablero
// de pedidos.

// Un pedido con su corte en la cola no se marca listo: el depósito lo
// despachaba sin las piezas. Terminado el corte, sí; y al entregarlo, el
// corte queda retirado.
func TestNoSeMarcaListoConElCorteEnCola(t *testing.T) {
	e := armar(t)
	dep, ses := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	pedido := e.pedido(t, ses, 1)
	e.exec(t, `update orders set estado = 'preparando' where id = $1`, pedido)
	corte := e.id(t, `insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado)
		values ('CRT-3', $1, 'Marta', 'Melamina 18', 'en-cola') returning id`, pedido)
	u := e.srv.URL + "/api/v1/admin/pedidos/" + pedido + "/avanzar"

	c, b := pedir(t, dep, "POST", u+"?desde=preparando", nil)
	if c != 422 || !strings.Contains(b, "El corte CRT-3 todavía no salió de la máquina") {
		t.Fatalf("con el corte en cola: %d %s", c, b)
	}
	e.exec(t, `update cutting_orders set estado = 'terminado' where id = $1`, corte)
	if c, b := pedir(t, dep, "POST", u+"?desde=preparando", nil); c != 200 || !strings.Contains(b, "listo para retirar") {
		t.Fatalf("con el corte terminado: %d %s", c, b)
	}
	if c, b := pedir(t, dep, "POST", u+"?desde=listo", map[string]any{"receptorDocumento": "20111222"}); c != 200 {
		t.Fatalf("entregar: %d %s", c, b)
	}
	if s := e.texto(t, `select estado::text from cutting_orders where id = $1`, corte); s != "retirado" {
		t.Errorf("el corte quedó %s", s)
	}
}

// El envío sale con su remito al despacharse (el camión salía sin papel),
// dice «listo para despachar», y no se da por entregado con algo por llevar.
func TestElEnvioSaleConRemitoAlDespachar(t *testing.T) {
	e := armar(t)
	dep, ses := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	pedido := e.pedido(t, ses, 2)
	e.exec(t, `update orders set tipo_entrega = 'envio', estado = 'preparando' where id = $1`, pedido)
	u := e.srv.URL + "/api/v1/admin/pedidos/" + pedido + "/avanzar"

	if c, b := pedir(t, dep, "POST", u+"?desde=preparando", nil); c != 200 || !strings.Contains(b, "listo para despachar") {
		t.Fatalf("listo: %d %s", c, b)
	}
	c, b := pedir(t, dep, "POST", u+"?desde=listo", nil)
	if c != 200 || !strings.Contains(b, "salió con el remito REM-") {
		t.Fatalf("despachar: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*) from deliveries where order_id = $1 and tipo = 'envio' and estado = 'preparada'`, pedido); n != 1 {
		t.Fatalf("el camión salió sin remito: %v", n)
	}
	if s := e.texto(t, `select estado::text from orders where id = $1`, pedido); s != "en-camino" {
		t.Fatalf("el pedido quedó %s", s)
	}

	// Un segundo pedido que salió en parte: no se entrega entero desde el
	// tablero.
	otro := e.pedido(t, ses, 2)
	e.exec(t, `update orders set tipo_entrega = 'envio', estado = 'en-camino' where id = $1`, otro)
	if c, b := pedir(t, dep, "POST", e.srv.URL+"/api/v1/admin/pedidos/"+otro+"/avanzar?desde=en-camino", nil); c != 422 || !strings.Contains(b, "por llevar") {
		t.Fatalf("entregado con algo por llevar: %d %s", c, b)
	}
}

// La ficha muestra lo cobrado y los recibos (un cobro parcial no se veía y
// el historial no registraba el cobro); el tablero dice qué falta llevar de
// un pedido que salió en parte y qué corte espera.
func TestFichaYTableroDicenLoCobradoYLoQueFalta(t *testing.T) {
	e := armar(t)
	_, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido := e.pedido(t, ses, 2)
	e.exec(t, `update orders set estado = 'listo', medio_pago = 'transferencia' where id = $1`, pedido)
	e.exec(t, `insert into receipts (numero, recibido_de, total, origen, order_id) values ('REC-0023', 'Marta', 1000, 'panel', $1)`, pedido)
	e.exec(t, `insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado) values ('CRT-3', $1, 'M', 'MDF', 'en-cola')`, pedido)
	item := e.id(t, `select id from order_items where order_id = $1`, pedido)
	remito := e.id(t, `insert into deliveries (numero, order_id, tipo, estado, firma_token) values ('REM-0001', $1, 'retiro', 'entregada', 'tok-mes-1') returning id`, pedido)
	e.exec(t, `insert into delivery_items (delivery_id, order_item_id, cantidad) values ($1, $2, 1)`, remito, item)

	f, err := e.s.Pedido(t.Context(), pedido, false)
	if err != nil {
		t.Fatal(err)
	}
	if f.Cobrado != 1000 || len(f.Recibos) != 1 || f.Recibos[0].Numero != "REC-0023" {
		t.Errorf("cobrado %v, recibos %+v", f.Cobrado, f.Recibos)
	}
	lista, err := e.s.ListarPedidos(t.Context(), Filtros{})
	if err != nil {
		t.Fatal(err)
	}
	var p *PedidoListado
	for i := range lista {
		if lista[i].ID == pedido {
			p = &lista[i]
		}
	}
	if p == nil || len(p.PorEntregar) != 2 || p.PorEntregar[0].Pendiente != 1 || len(p.CortesSinTerminar) != 1 || p.CortesSinTerminar[0] != "CRT-3" {
		t.Fatalf("listado: %+v", p)
	}
}
