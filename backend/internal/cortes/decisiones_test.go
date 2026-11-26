package cortes

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/reglas"
)

// H045: el corte suelto. Con la regla de arranque («primera») sin sucursal
// va a la primera; con «preguntar» y más de una sucursal, Go lo rechaza
// hasta que se elija. El corte de un pedido no pregunta: usa la del pedido.
func TestDondeSeCortaElCorteSuelto(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	aserradero := e.txt(t, `insert into branches (slug, name, sort_order) values ('aserradero', 'Aserradero', 2) returning id::text`)

	id := alta(t, e, ven, melamina(e))
	if s := e.txt(t, `select branch_id::text from cutting_orders where id = $1`, id); s != e.central {
		t.Errorf("de arranque, la primera: %s", s)
	}
	if err := reglas.Fijar(ctx, e.pool, reglas.SucursalDelCorteSuelto, "preguntar"); err != nil {
		t.Fatal(err)
	}
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", melamina(e)); code != 422 || !strings.Contains(b, "Elegí dónde se corta.") {
		t.Errorf("sin elegir: %d %s", code, b)
	}
	id = alta(t, e, ven, melamina(e, "branchId", aserradero))
	if s := e.txt(t, `select branch_id::text from cutting_orders where id = $1`, id); s != aserradero {
		t.Errorf("la elegida: %s", s)
	}
	pedido := e.pedido(t, "PED-1070", map[string]any{"variante": e.melamina, "descripcion": "Melamina Blanca", "unidad": "placa", "cantidad": 1, "precio": 84500})
	alta(t, e, ven, melamina(e, "orderId", pedido))
	// Con una sola sucursal activa no hay nada que preguntar.
	if _, err := e.pool.Exec(ctx, `update branches set active = false where id = $1`, aserradero); err != nil {
		t.Fatal(err)
	}
	alta(t, e, ven, melamina(e))
}
