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

// Comité del 25/11: unir a mano no puede volver a hacer lo que hacía la unión
// automática. Una ficha con cuenta web no se ofrece (lo unido lo vería esa
// persona en su portal) y, con dos fichas con el mismo correo, ninguna.
func TestUnirNoOfreceFichasDudosas(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	u := e.srv.URL + "/api/v1/admin/"

	// Con cuenta web: no se ofrece y no se une.
	e.exec(t, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('u-web', 'Web', 'web@prueba.test', true, now(), now())`)
	conCuenta := e.id(t, `insert into customers (nombre, email, user_id) values ('Con cuenta', 'web@prueba.test', 'u-web') returning id`)
	p1 := e.id(t, `insert into orders (numero, contacto_nombre, contacto_email, origen) values ('PED-10', 'X', 'web@prueba.test', 'tienda') returning id`)
	_, b := pedir(t, ven, "GET", u+"pedidos/"+p1, nil)
	if f := leer[FichaDePedido](t, b).FichaPorCorreo; f != nil {
		t.Fatalf("ofreció una ficha con cuenta web: %s", b)
	}
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+p1+"/ficha", map[string]any{"customerId": conCuenta}); c != 422 || !strings.Contains(b, msjFichaAjena) {
		t.Fatalf("unió a una ficha con cuenta web: %d %s", c, b)
	}

	// Dos fichas con el mismo correo: ninguna.
	a := e.id(t, `insert into customers (nombre, email, telefono) values ('Ana Uno', 'ana@prueba.test', '223 111') returning id`)
	p2 := e.id(t, `insert into orders (numero, contacto_nombre, contacto_email, origen) values ('PED-11', 'Ana', 'ana@prueba.test', 'tienda') returning id`)
	_, b = pedir(t, ven, "GET", u+"pedidos/"+p2, nil)
	if f := leer[FichaDePedido](t, b).FichaPorCorreo; f == nil || f.ID != a || f.Telefono == nil || *f.Telefono != "223 111" {
		t.Fatalf("con una sola, la ofrece con su teléfono: %s", b)
	}
	e.id(t, `insert into customers (nombre, email) values ('Ana Dos', 'ANA@prueba.test') returning id`)
	_, b = pedir(t, ven, "GET", u+"pedidos/"+p2, nil)
	if f := leer[FichaDePedido](t, b).FichaPorCorreo; f != nil {
		t.Fatalf("con dos fichas ofreció una: %s", b)
	}
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+p2+"/ficha", map[string]any{"customerId": a}); c != 422 {
		t.Fatalf("con dos fichas unió: %d %s", c, b)
	}
}

// M2S2-069 y M2S1-193: el presupuesto armado en el panel con el correo de
// un cliente que tiene cuenta web se ofrece unir a su ficha, y al unirlo
// toma el nombre y el teléfono de la ficha. Uno que llegó del sitio, no.
func TestUnirPresupuestoDelPanelAFichaConCuentaWeb(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.exec(t, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('web', 'Diego', 'sim.monotributo@ejemplo.test', true, now(), now())`)
	ficha := e.id(t, `insert into customers (nombre, email, telefono, user_id) values ('Sim Diego Monotributista', 'sim.monotributo@ejemplo.test', '223 555-0102', 'web') returning id`)
	delPanel := e.id(t, `insert into quotes (numero, contacto_nombre, contacto_email, origen) values ('P-5', 'Rocío (consulta web)', 'sim.monotributo@ejemplo.test', 'telefono') returning id`)
	delSitio := e.id(t, `insert into quotes (numero, contacto_nombre, contacto_email, origen) values ('P-4', 'Diego (consulta web)', 'sim.monotributo@ejemplo.test', 'sitio') returning id`)
	u := e.srv.URL + "/api/v1/admin/"
	_, b := pedir(t, ven, "GET", u+"presupuestos/"+delSitio, nil)
	if f := leer[FichaDePresupuesto](t, b).FichaPorCorreo; f != nil {
		t.Fatalf("el del sitio ofrece la ficha con cuenta web: %s", b)
	}
	_, b = pedir(t, ven, "GET", u+"presupuestos/"+delPanel, nil)
	if f := leer[FichaDePresupuesto](t, b).FichaPorCorreo; f == nil || f.ID != ficha {
		t.Fatalf("el del panel no ofrece la ficha: %s", b)
	}
	if c, b := pedir(t, ven, "POST", u+"presupuestos/"+delPanel+"/ficha", map[string]any{"customerId": ficha}); c != 200 {
		t.Fatalf("unir: %d %s", c, b)
	}
	var nombre, tel string
	_ = e.pool.QueryRow(t.Context(), `select contacto_nombre, coalesce(contacto_telefono, '') from quotes where id = $1`, delPanel).Scan(&nombre, &tel)
	if nombre != "Sim Diego Monotributista" || tel != "223 555-0102" {
		t.Errorf("el presupuesto quedó %q %q", nombre, tel)
	}
}
