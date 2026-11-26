package cortes

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// La venta del mostrador que lleva un corte queda en curso; cuando el
// último corte sale de la máquina, pasa sola a listo con el aviso al
// cliente (mes simulado: quedaba «entregado» con las piezas en cola).
func TestElCorteTerminadoDejaListaLaVentaDelMostrador(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor-mes@prueba.test", sqlc.StaffRoleVendedor)
	ctx := context.Background()
	uno := func(sql string, args ...any) string {
		t.Helper()
		var v string
		if err := e.pool.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	pedido := uno(`insert into orders (numero, estado, origen, subtotal, total, contacto_nombre)
		values ('PED-1114', 'preparando', 'mostrador', 100, 100, 'Gabriel') returning id::text`)
	a := uno(`insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado)
		values ('CRT-922', $1, 'Gabriel', 'Melamina 18', 'en-proceso') returning id::text`, pedido)
	b := uno(`insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado)
		values ('CRT-923', $1, 'Gabriel', 'Melamina 18', 'en-proceso') returning id::text`, pedido)
	u := e.srv.URL + "/api/v1/admin/cortes/"

	if c, cuerpo := pedir(t, ven, "POST", u+a+"/avanzar?desde=en-proceso", nil); c != 200 || !strings.Contains(cuerpo, "terminado") {
		t.Fatalf("%d %s", c, cuerpo)
	}
	if s := uno(`select estado::text from orders where id = $1`, pedido); s != "preparando" {
		t.Fatalf("con un corte todavía en la máquina quedó %s", s)
	}
	if c, cuerpo := pedir(t, ven, "POST", u+b+"/avanzar?desde=en-proceso", nil); c != 200 {
		t.Fatalf("%d %s", c, cuerpo)
	}
	if s := uno(`select estado::text from orders where id = $1`, pedido); s != "listo" {
		t.Fatalf("con los cortes terminados quedó %s", s)
	}
	if n := uno(`select count(*)::text from trabajos where tipo = 'pedido.estado'`); n != "1" {
		t.Errorf("avisos: %s", n)
	}
}
