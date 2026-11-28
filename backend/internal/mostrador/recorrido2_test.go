package mostrador

import (
	"context"
	"testing"

	"mjbj/internal/sqlc"
)

// Recorrido 2 (nuevo 8): el cobro de cuenta del mostrador ve los cheques
// que el cliente informó desde el portal, como el del panel.
func TestElSaldoDelMostradorTraeLosChequesInformados(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	if _, err := e.pool.Exec(context.Background(), `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, customer_id)
		values ('recibido', '00440201', 'Nación', '2026-12-10', 30000, 'informado', $1), ('recibido', '00440202', 'Nación', '2026-12-10', 5000, 'cartera', $1)`, e.cliente); err != nil {
		t.Fatal(err)
	}
	st, m, b := pedir(t, ven, "GET", e.u+"/api/v1/mostrador/clientes/"+e.cliente+"/saldo", nil)
	inf, _ := m["informados"].(map[string]any)
	if st != 200 || inf["cantidad"] != 1.0 || inf["total"] != 30000.0 {
		t.Errorf("informados: %d %s", st, b)
	}
}
