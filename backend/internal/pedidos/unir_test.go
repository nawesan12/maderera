package pedidos

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// El pedido o presupuesto anónimo con el correo de un cliente queda sin
// cliente (checkout.clientePorCorreo); la ficha del panel muestra la ficha
// con ese correo y quien entra a Clientes lo une a mano.
func TestUnirALaFichaDelCorreo(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	dep, _ := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	ficha := e.id(t, `insert into customers (nombre, email) values ('Juan de verdad', 'Juan@Prueba.test') returning id`)
	otra := e.id(t, `insert into customers (nombre, email) values ('Otro', 'otro@prueba.test') returning id`)
	pedido := e.id(t, `insert into orders (numero, contacto_nombre, contacto_email, origen) values ('PED-1', 'Juan', 'juan@prueba.test', 'tienda') returning id`)
	pagado := e.id(t, `insert into orders (numero, contacto_nombre, contacto_email, origen) values ('PED-2', 'Juan', 'juan@prueba.test', 'tienda') returning id`)
	e.exec(t, `insert into receipts (numero, recibido_de, total, origen, order_id) values ('R-1', 'Juan', 100, 'mercado_pago', $1)`, pagado)
	// Lo que la compra anónima dejó sin cliente: un pago y un corte.
	e.exec(t, `insert into payments (order_id, tipo, proveedor, monto, estado) values ($1, 'pedido', 'mercado_pago', 100, 'iniciado')`, pedido)
	e.exec(t, `insert into cutting_orders (numero, contacto_nombre, material_descripcion, estado, order_id) values ('C-1', 'Juan', 'MDF', 'terminado', $1)`, pedido)
	presu := e.id(t, `insert into quotes (numero, contacto_nombre, contacto_email, origen) values ('P-1', 'Juan', 'juan@prueba.test', 'sitio') returning id`)
	u := e.srv.URL + "/api/v1/admin/"

	// La ficha del pedido muestra con quién se puede unir.
	_, b := pedir(t, ven, "GET", u+"pedidos/"+pedido, nil)
	if f := leer[FichaDePedido](t, b).FichaPorCorreo; f == nil || f.ID != ficha || !f.Unible {
		t.Fatalf("ficha por correo: %s", b)
	}
	_, b = pedir(t, ven, "GET", u+"pedidos/"+pagado, nil)
	if f := leer[FichaDePedido](t, b).FichaPorCorreo; f == nil || f.Unible {
		t.Fatalf("con recibo no se une: %s", b)
	}
	_, b = pedir(t, ven, "GET", u+"presupuestos/"+presu, nil)
	if f := leer[FichaDePresupuesto](t, b).FichaPorCorreo; f == nil || f.ID != ficha || !f.Unible {
		t.Fatalf("presupuesto: %s", b)
	}

	// El depósito abre Pedidos pero no toca fichas.
	if c, b := pedir(t, dep, "POST", u+"pedidos/"+pedido+"/ficha", map[string]any{"customerId": ficha}); c != 403 {
		t.Fatalf("depósito: %d %s", c, b)
	}
	// Solo a la ficha con ese correo.
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+pedido+"/ficha", map[string]any{"customerId": otra}); c != 422 || !strings.Contains(b, msjFichaAjena) {
		t.Fatalf("otra ficha: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+pagado+"/ficha", map[string]any{"customerId": ficha}); c != 422 || !strings.Contains(b, msjConPapeles) {
		t.Fatalf("con recibo: %d %s", c, b)
	}
	c, b := pedir(t, ven, "POST", u+"pedidos/"+pedido+"/ficha", map[string]any{"customerId": ficha})
	if c != 200 || !strings.Contains(b, "El pedido PED-1 quedó en la ficha de Juan de verdad.") {
		t.Fatalf("unir: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*) from orders where id = $1 and customer_id = $2`, pedido, ficha); n != 1 {
		t.Fatal("no quedó unido")
	}
	if n := e.numero(t, `select count(*) from payments where order_id = $1 and customer_id = $2`, pedido, ficha); n != 1 {
		t.Error("el pago del pedido quedó sin cliente")
	}
	if n := e.numero(t, `select count(*) from cutting_orders where order_id = $1 and customer_id = $2`, pedido, ficha); n != 1 {
		t.Error("el corte del pedido quedó sin cliente")
	}
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+pedido+"/ficha", map[string]any{"customerId": ficha}); c != 422 || !strings.Contains(b, msjYaTiene) {
		t.Fatalf("dos veces: %d %s", c, b)
	}
	_, b = pedir(t, ven, "GET", u+"pedidos/"+pedido, nil)
	if leer[FichaDePedido](t, b).FichaPorCorreo != nil {
		t.Fatalf("unido, ya no ofrece: %s", b)
	}
	if c, b := pedir(t, ven, "POST", u+"presupuestos/"+presu+"/ficha", map[string]any{"customerId": ficha}); c != 200 || !strings.Contains(b, "El presupuesto P-1") {
		t.Fatalf("unir presupuesto: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*) from audit_log where descripcion like 'Unió % a la ficha de Juan de verdad%'`); n != 2 {
		t.Fatalf("bitácora: %v", n)
	}
}
