package cobros

import (
	"context"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas/fragmentos"
)

// La seña de un pedido de contado cobrada desde la ficha del cliente queda
// atada al pedido y se descuenta de lo que falta cobrar: el reparto pedía el
// total entero y «Me deben» lo sumaba otra vez, mientras la cuenta quedaba
// con un saldo a favor que no existía. El pago no va a la cuenta (la deuda
// del pedido tampoco está ahí), el pedido queda pagado cuando lo cobrado
// cubre el total, y anular el recibo no toca la cuenta.
//
// Una transferencia informada y sin verificar tampoco es «sin cobrar».
func TestSenaDeUnPedidoDeContado(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('admin', 'Admin', 'admin@prueba.test', true, now(), now())`)
	admin := sqlc.StaffRoleAdmin
	ses := &auth.Sesion{UserID: "admin", Rol: sqlc.UserRoleStaff, RolStaff: &admin}
	var pedido string
	if err := b.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, medio_pago, total, customer_id)
		values ('PED-1', 'Juan', $1, 'presupuesto', 'listo', 'efectivo', 100000, $2) returning id`, b.sucursal, b.cliente).Scan(&pedido); err != nil {
		t.Fatal(err)
	}
	falta := func() *float64 {
		var f *float64
		if err := b.pool.QueryRow(ctx, `select `+fragmentos.SinCobrarDelPedido+`::float8 from orders o where o.id = $1`, pedido).Scan(&f); err != nil {
			t.Fatal(err)
		}
		return f
	}
	estadoPago := func() string {
		var e string
		_ = b.pool.QueryRow(ctx, `select estado_pago::text from orders where id = $1`, pedido).Scan(&e)
		return e
	}
	// El efectivo entra a la caja de la sucursal del pedido: sin caja abierta
	// no se cobra en efectivo.
	_, _ = b.pool.Exec(ctx, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, 'admin', now())`, b.sucursal)
	s := Nuevo(b.pool, silencio)

	sena, err := s.CobrarACliente(ctx, ses, b.cliente, pedido, "", `[{"medio":"efectivo","importe":"30000"}]`, "")
	if err != nil {
		t.Fatal(err)
	}
	if f := falta(); f == nil || *f != 70000 || estadoPago() != "pendiente" {
		t.Fatalf("después de la seña: falta %v, %s", f, estadoPago())
	}
	if sd := saldo(t, b); sd != 0 {
		t.Errorf("la seña de un pedido de contado no va a la cuenta: saldo %v", sd)
	}
	var atado string
	_ = b.pool.QueryRow(ctx, `select coalesce(order_id::text, '') from receipts where id = $1`, *sena.ReceiptID).Scan(&atado)
	if atado != pedido {
		t.Errorf("el recibo no quedó atado al pedido: %q", atado)
	}

	// La transferencia del resto, informada y sin verificar: no se reclama.
	_, _ = b.pool.Exec(ctx, `insert into payments (order_id, customer_id, tipo, proveedor, medio, monto, estado)
		values ($1, $2, 'pedido', 'transferencia', 'transferencia', 70000, 'en_revision')`, pedido, b.cliente)
	if f := falta(); f != nil {
		t.Errorf("con la transferencia en revisión: falta %v", *f)
	}
	_, _ = b.pool.Exec(ctx, `update payments set estado = 'rechazado' where order_id = $1`, pedido)
	if f := falta(); f == nil || *f != 70000 {
		t.Errorf("rechazada, vuelve a faltar: %v", f)
	}

	// El resto con otro recibo: lo cobrado cubre el total y queda pagado.
	if _, err := s.CobrarACliente(ctx, ses, b.cliente, pedido, "", `[{"medio":"efectivo","importe":"70000"}]`, ""); err != nil {
		t.Fatal(err)
	}
	if estadoPago() != "pagado" || falta() != nil {
		t.Errorf("con los dos recibos: %s, falta %v", estadoPago(), falta())
	}

	// Anular la seña no inventa movimientos en la cuenta.
	if _, err := s.Anular(ctx, ses, *sena.ReceiptID, "Se cargó dos veces"); err != nil {
		t.Fatal(err)
	}
	if sd := saldo(t, b); sd != 0 {
		t.Errorf("anular la seña no toca la cuenta: saldo %v", sd)
	}
}
