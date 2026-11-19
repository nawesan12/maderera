package reportes

import (
	"context"
	"testing"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/cobros"
	"mjbj/internal/sqlc"
)

// El cobro de un pedido sin cliente desde su ficha (cobros.CobrarPedido)
// caía en una cuenta propia, sin facturas: iba entero al B y la factura con
// CAE quedaba abierta en Deudores (comité final, A4). Ahora la cuenta es la
// del pedido: con la factura ya emitida, el cobro va contra Deudores; antes
// de facturar, como anticipo del pedido, que se aplica cuando sale la
// factura. En los dos, Deudores y Anticipos del CSV blanco cierran en 0 y no
// hay nada en el B.
func TestCobroDeUnPedidoSinCliente(t *testing.T) {
	e := armar(t)
	e.staff(t, "admin@prueba.test", "admin")
	usuario := e.id(t, `select id from "user" limit 1`)
	admin := sqlc.StaffRoleAdmin
	ses := &auth.Sesion{UserID: usuario, Rol: sqlc.UserRoleStaff, RolStaff: &admin}
	s := cobros.Nuevo(e.pool, silencio)
	ctx := context.Background()
	cobrar := func(pedido, clave string) string {
		t.Helper()
		r, err := s.CobrarPedido(ctx, ses, pedido, `[{"medio":"transferencia","importe":"1210"}]`, clave, "")
		if err != nil || r.ReceiptID == nil {
			t.Fatalf("cobrando: %v", err)
		}
		e.exec(t, `update receipts set created_at = '2026-10-07T15:00:00Z' where id = $1`, *r.ReceiptID)
		return *r.ReceiptID
	}

	// Facturado con CAE y después cobrado.
	facturado := e.pedido(t, "PED-1", e.central, "entregado", "presupuesto", time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina), nil)
	e.exec(t, `update orders set total = 1210, medio_pago = 'transferencia' where id = $1`, facturado)
	e.facturaConCae(t, nil, 30, 1210, "2026-10-06T15:00:00Z", &facturado)
	cobrar(facturado, "clave-1")

	// Cobrado antes de facturar, con el pedido abierto: es seña.
	abierto := e.pedido(t, "PED-2", e.central, "pendiente", "presupuesto", time.Date(2026, 10, 5, 12, 0, 0, 0, Argentina), nil)
	e.exec(t, `update orders set total = 1210, medio_pago = 'transferencia' where id = $1`, abierto)
	sena := cobrar(abierto, "clave-2")
	var anticipo float64
	if err := e.pool.QueryRow(ctx, `select reparto_anticipo::float8 from receipts where id = $1`, sena).Scan(&anticipo); err != nil || anticipo != 1210 {
		t.Fatalf("la seña del pedido sin cliente: anticipo %v (%v)", anticipo, err)
	}
	e.facturaConCae(t, nil, 31, 1210, "2026-10-10T15:00:00Z", &abierto)

	octubre := e.asientosDe(t, "2026-10")
	blanco, b := DelCircuito(octubre, "blanco"), DelCircuito(octubre, CircuitoNegro)
	if d := cuenta(blanco, Cuentas.Deudores); d != 0 {
		t.Errorf("Deudores del CSV blanco: %v", d)
	}
	if a := cuenta(blanco, Cuentas.AnticiposDeClientes); a != 0 {
		t.Errorf("Anticipos del CSV blanco: %v", a)
	}
	if bco := cuenta(blanco, Cuentas.Banco); bco != 2420 {
		t.Errorf("las dos transferencias en el banco del CSV blanco: %v", bco)
	}
	if len(b) != 0 {
		t.Errorf("nada va al B: %+v", b)
	}
}
