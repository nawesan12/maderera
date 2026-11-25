package checkout

import (
	"net/http"
	"testing"
)

// Una compra o un presupuesto sin sesión con el correo de un cliente que ya
// existe no queda en su ficha (auditoría del 30/10, default prudente): ni en
// su historial, ni en su cuenta corriente, ni en su portal, que lista por
// customer_id. Con la sesión de ese correo, sí.
func TestElCorreoDeOtroNoAtaLaCompraASuFicha(t *testing.T) {
	e := armar(t)
	u := e.srv.URL + "/api/v1/carrito"
	ficha := e.id(t, `insert into customers (nombre, email) values ('Juan de verdad', 'juan@prueba.test') returning id`)

	comprar := func(cl *http.Client, extra map[string]any) Compra {
		t.Helper()
		pedir(t, cl, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico", "cantidad": 1})
		code, b := pedir(t, cl, "POST", u+"/confirmar", e.compra(extra))
		if code != 200 {
			t.Fatalf("confirmar: %d %s", code, b)
		}
		return leer[Compra](t, b)
	}
	presupuesto := func(cl *http.Client, correo string) Presupuesto {
		t.Helper()
		pedir(t, cl, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico", "cantidad": 1})
		code, b := pedir(t, cl, "POST", u+"/presupuesto", map[string]any{"nombre": "Juan", "email": correo, "telefono": "2235551234"})
		if code != 200 {
			t.Fatalf("presupuesto: %d %s", code, b)
		}
		return leer[Presupuesto](t, b)
	}

	// Sin sesión, con el correo de Juan: el pedido y el presupuesto quedan sin cliente.
	c := comprar(e.anonimo(), nil)
	if n := e.numero(t, `select count(*) from orders where id = $1 and customer_id is null and contacto_email = 'juan@prueba.test'`, c.PedidoID); n != 1 {
		t.Fatal("la compra anónima quedó en la ficha de Juan")
	}
	p := presupuesto(e.anonimo(), "juan@prueba.test")
	if n := e.numero(t, `select count(*) from quotes where id = $1 and customer_id is null`, p.QuoteID); n != 1 {
		t.Fatal("el presupuesto anónimo quedó en la ficha de Juan")
	}
	// Lo que lee el portal de Juan y su cuenta corriente: nada.
	if n := e.numero(t, `select count(*) from orders where customer_id = $1`, ficha); n != 0 {
		t.Fatalf("el portal de Juan ve %v pedidos ajenos", n)
	}
	if n := e.numero(t, `select count(*) from quotes where customer_id = $1`, ficha); n != 0 {
		t.Fatalf("el portal de Juan ve %v presupuestos ajenos", n)
	}
	if n := e.numero(t, `select count(*) from account_movements where customer_id = $1`, ficha); n != 0 {
		t.Fatalf("la cuenta de Juan tiene %v movimientos", n)
	}

	// Con la sesión de otro correo, tampoco.
	ana, _ := e.web(t, "ana@prueba.test")
	e.exec(t, `delete from customers where email = 'ana@prueba.test'`)
	c = comprar(ana, nil)
	if n := e.numero(t, `select count(*) from orders where id = $1 and customer_id is null`, c.PedidoID); n != 1 {
		t.Fatal("la sesión de Ana con el correo de Juan quedó en su ficha")
	}

	// Con la sesión de Juan (la ficha todavía sin la cuenta web), sí.
	juan, _ := e.web(t, "juan@prueba.test")
	e.exec(t, `update customers set user_id = null where id = $1`, ficha)
	c = comprar(juan, nil)
	if n := e.numero(t, `select count(*) from orders where id = $1 and customer_id = $2`, c.PedidoID, ficha); n != 1 {
		t.Fatal("la compra con la sesión de Juan no quedó en su ficha")
	}
	p = presupuesto(juan, "juan@prueba.test")
	if n := e.numero(t, `select count(*) from quotes where id = $1 and customer_id = $2`, p.QuoteID, ficha); n != 1 {
		t.Fatal("el presupuesto con la sesión de Juan no quedó en su ficha")
	}
}

// Comité del 25/11: la compra buscaba la ficha con `email = $1` exacto y sin
// orden, distinto del panel (lower y la más vieja). «Pedro@…» no se ataba a
// «pedro@…», y con dos fichas con el mismo correo la elegida cambiaba. Ahora
// el criterio es el mismo, y primero va la ficha de la cuenta que compra.
func TestLaFichaPorCorreoSinMayusculasYLaPropiaPrimero(t *testing.T) {
	e := armar(t)
	u := e.srv.URL + "/api/v1/carrito"
	comprar := func(cl *http.Client) Compra {
		t.Helper()
		pedir(t, cl, "POST", u+"/items", map[string]any{"variantId": e.placa, "descripcion": "Fenólico", "cantidad": 1})
		code, b := pedir(t, cl, "POST", u+"/confirmar", e.compra(map[string]any{"email": "pedro@prueba.test"}))
		if code != 200 {
			t.Fatalf("confirmar: %d %s", code, b)
		}
		return leer[Compra](t, b)
	}
	pedro, ses := e.web(t, "pedro@prueba.test")
	e.exec(t, `delete from customers where email ilike 'pedro@prueba.test'`)
	vieja := e.id(t, `insert into customers (nombre, email, created_at) values ('Pedro (ficha del mostrador)', ' Pedro@Prueba.TEST', now() - interval '1 year') returning id`)

	c := comprar(pedro)
	if n := e.numero(t, `select count(*) from orders where id = $1 and customer_id = $2`, c.PedidoID, vieja); n != 1 {
		t.Fatal("con mayúsculas y espacios en la ficha, la compra no se ató")
	}

	// La ficha de su cuenta web va antes que la más vieja sin cuenta.
	propia := e.id(t, `insert into customers (nombre, email, user_id) values ('Pedro web', 'pedro@prueba.test', $1) returning id`, ses.UserID)
	c = comprar(pedro)
	if n := e.numero(t, `select count(*) from orders where id = $1 and customer_id = $2`, c.PedidoID, propia); n != 1 {
		t.Fatal("con dos fichas, la compra no fue a la de su cuenta")
	}
}
