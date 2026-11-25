package mostrador

import (
	"context"
	"testing"
	"time"

	"mjbj/internal/sqlc"
)

// M1: «numeroProvisorio» lo manda el navegador, y con él una venta a cuenta
// de un cliente bloqueado entraba igual. Pasarse del límite sigue entrando
// (y queda marcado); la cuenta bloqueada, no.
func TestColaConCuentaBloqueada(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	if _, err := e.pool.Exec(context.Background(), `update customers set cuenta_bloqueada = true where id = $1`, e.cliente); err != nil {
		t.Fatal(err)
	}
	venta := e.venta("cuenta_corriente", e.lineaPlaca(1))
	venta["customerId"] = e.cliente
	venta["numeroProvisorio"] = "CAJA1-011"
	venta["cobradaAt"] = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/descarga", map[string]any{"cuerpo": map[string]any{"ventas": []any{venta}}})
	r0 := m["resultados"].([]any)[0].(map[string]any)
	if r0["estado"] != "rechazada" {
		t.Fatalf("la cuenta bloqueada entró por la cola: %s", b)
	}
	if n := e.num(t, `select count(*)::float8 from account_movements where customer_id = $1`, e.cliente); n != 0 {
		t.Errorf("deuda cargada: %v", n)
	}
}
