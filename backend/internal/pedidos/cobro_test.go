package pedidos

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// El cobro del pedido desde su ficha (T3, hallazgo 5): pasa por el recibo y
// por la caja, no cobra más que el saldo, es repetible por su clave y el
// depósito no lo usa.
func TestCobroDelPedido(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	dep, _ := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	u := e.srv.URL + "/api/v1/admin/pedidos/"
	// Un pedido de contado sin cliente: el recibo sale a nombre del contacto.
	pedido := e.id(t, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, medio_pago, subtotal, total)
		values ('PED-7', 'Juan Pérez', $1, 'presupuesto', 'listo', 'efectivo', 100000, 100000) returning id`, e.sucursal)
	efectivo := func(monto string) string { return `[{"medio":"efectivo","importe":"` + monto + `"}]` }

	if c, b := pedir(t, dep, "POST", u+pedido+"/cobro", map[string]any{"partes": efectivo("100000")}); c != 403 {
		t.Fatalf("el depósito cobró: %d %s", c, b)
	}
	// En efectivo sin caja abierta, no: y dice de qué sucursal es la caja.
	c, b := pedir(t, ven, "POST", u+pedido+"/cobro", map[string]any{"partes": efectivo("30000"), "clave": "k-1"})
	if c != 422 || !strings.Contains(b, "Abrí la caja para cobrar en efectivo.") || !strings.Contains(b, e.sucursal) {
		t.Fatalf("efectivo sin caja: %d %s", c, b)
	}
	// Una transferencia sin caja sí: esa plata ya está en el banco.
	if c, b := pedir(t, ven, "POST", u+pedido+"/cobro", map[string]any{"partes": `[{"medio":"transferencia","importe":"20000"}]`, "clave": "k-2"}); c != 200 {
		t.Fatalf("transferencia sin caja: %d %s", c, b)
	}
	turno := e.id(t, `insert into cash_sessions (branch_id, abierta_por) values ($1, (select id from "user" where email = 'vendedor@prueba.test')) returning id`, e.sucursal)

	// Más que el saldo, no (quedan 80000).
	if c, b := pedir(t, ven, "POST", u+pedido+"/cobro", map[string]any{"partes": efectivo("90000"), "clave": "k-3"}); c != 422 || !strings.Contains(b, "A PED-7 le faltan 80000.00") {
		t.Fatalf("más que el saldo: %d %s", c, b)
	}
	// Con caja entra al turno; la misma clave otra vez es el mismo recibo, sin
	// otra entrada de efectivo.
	for i := 0; i < 2; i++ {
		if c, b := pedir(t, ven, "POST", u+pedido+"/cobro", map[string]any{"partes": efectivo("30000"), "clave": "k-4"}); c != 200 {
			t.Fatalf("efectivo con caja (%d): %d %s", i, c, b)
		}
	}
	if n := e.numero(t, `select count(*) from receipts where order_id = $1`, pedido); n != 2 {
		t.Errorf("recibos: %v", n)
	}
	if m := e.numero(t, `select coalesce(sum(monto), 0) from cash_movements where session_id = $1`, turno); m != 30000 {
		t.Errorf("caja: %v", m)
	}
	if de := e.texto(t, `select recibido_de from receipts where clave = 'k-4'`); de != "Juan Pérez" {
		t.Errorf("a nombre de: %s", de)
	}
	// La misma clave con otro monto: 409, no el recibo viejo como si nada.
	if c, b := pedir(t, ven, "POST", u+pedido+"/cobro", map[string]any{"partes": efectivo("10000"), "clave": "k-4"}); c != 409 {
		t.Fatalf("misma clave, otro monto: %d %s", c, b)
	}
	if e.texto(t, `select estado_pago::text from orders where id = $1`, pedido) != "pendiente" {
		t.Error("con saldo no está pagado")
	}
	// El resto lo deja pagado: por la suma, no por un botón.
	if c, b := pedir(t, ven, "POST", u+pedido+"/cobro", map[string]any{"partes": efectivo("50000"), "clave": "k-5"}); c != 200 {
		t.Fatalf("el resto: %d %s", c, b)
	}
	if e.texto(t, `select estado_pago::text from orders where id = $1`, pedido) != "pagado" {
		t.Error("cubierto el total, queda pagado")
	}
}

// El aserradero ve el pedido sin plata (T3, hallazgo 40): la ficha completa
// le da 403 y la del taller no trae importes, mail, teléfono ni saldo.
func TestPedidoParaElTaller(t *testing.T) {
	e := armar(t)
	ase, _ := e.staff(t, "aserradero@prueba.test", sqlc.StaffRoleAserradero)
	pedido := e.id(t, `insert into orders (numero, contacto_nombre, contacto_email, contacto_telefono, branch_id, origen, estado, subtotal, total)
		values ('PED-8', 'Ana', 'ana@prueba.test', '2235551234', $1, 'presupuesto', 'pendiente', 84500, 84500) returning id`, e.sucursal)
	e.exec(t, `insert into order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal)
		values ($1, $2, 'Fenólico 18 mm', 'placa', 1, 84500, 84500)`, pedido, e.placa)
	u := e.srv.URL + "/api/v1/admin/pedidos/" + pedido
	if c, _ := pedir(t, ase, "GET", u, nil); c != 403 {
		t.Fatalf("la ficha completa: %d", c)
	}
	c, b := pedir(t, ase, "GET", u+"/taller", nil)
	if c != 200 || !strings.Contains(b, `"numero":"PED-8"`) || !strings.Contains(b, `"cantidad":"1.00"`) {
		t.Fatalf("taller: %d %s", c, b)
	}
	for _, no := range []string{"84500", "ana@prueba.test", "2235551234", "total", "saldo", "precio"} {
		if strings.Contains(b, no) {
			t.Errorf("la ficha del taller trae %q: %s", no, b)
		}
	}
}
