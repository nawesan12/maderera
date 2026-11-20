package pedidos

import (
	"strings"
	"testing"

	"mjbj/internal/entregas"
	"mjbj/internal/sqlc"
)

// «Avanzar» a entregado en un retiro emite el remito por lo que queda: pide
// el documento de quien retira, como el remito a mano, y lo guarda. En un
// envío no pide nada.
func TestAvanzarUnRetiroPideElDocumento(t *testing.T) {
	e := armar(t)
	dep, ses := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	retiro := e.pedido(t, ses, 1)
	envio := e.pedido(t, ses, 1)
	e.exec(t, `update orders set tipo_entrega = 'envio' where id = $1`, envio)
	e.exec(t, `update orders set estado = 'listo'`)
	u := e.srv.URL + "/api/v1/admin/pedidos/"

	// Sin documento: 422 en el campo, y nada se movió.
	for _, cuerpo := range []any{nil, map[string]any{"receptorNombre": "Pedro"}, map[string]any{"receptorDocumento": "   "}} {
		c, b := pedir(t, dep, "POST", u+retiro+"/avanzar?desde=listo", cuerpo)
		if c != 422 || !strings.Contains(b, entregas.MsjFaltaDocumento) || !strings.Contains(b, "receptorDocumento") {
			t.Fatalf("sin documento (%v): %d %s", cuerpo, c, b)
		}
	}
	if n := e.numero(t, `select count(*) from deliveries where order_id = $1`, retiro); n != 0 {
		t.Fatalf("salió un remito sin documento: %v", n)
	}
	if s := e.texto(t, `select estado::text from orders where id = $1`, retiro); s != "listo" {
		t.Fatalf("el pedido avanzó: %s", s)
	}

	// Con documento: entregado, y el remito lo guarda.
	c, b := pedir(t, dep, "POST", u+retiro+"/avanzar?desde=listo", map[string]any{"receptorNombre": " Pedro Gómez ", "receptorDocumento": " 30111222 "})
	if c != 200 || !strings.Contains(b, "entregado") {
		t.Fatalf("con documento: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*) from deliveries where order_id = $1 and tipo = 'retiro'
		and receptor_nombre = 'Pedro Gómez' and receptor_documento = '30111222'`, retiro); n != 1 {
		t.Fatalf("el remito no guardó quién retira: %v", n)
	}

	// Un envío pasa a «en camino» y a entregado sin que se le pida nada.
	for _, desde := range []string{"listo", "en-camino"} {
		if c, b := pedir(t, dep, "POST", u+envio+"/avanzar?desde="+desde, nil); c != 200 {
			t.Fatalf("envío desde %s: %d %s", desde, c, b)
		}
	}
	if n := e.numero(t, `select count(*) from deliveries where order_id = $1 and tipo = 'envio' and receptor_documento is null`, envio); n != 1 {
		t.Fatalf("el envío no salió con su remito: %v", n)
	}
}
