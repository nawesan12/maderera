package cobros

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/sqlc"
)

// Mes simulado (H272, H342): el cheque que el cliente entregó con una venta
// del mostrador no aparecía en la ficha (el filtro «Cheques» decía que no
// había nada), y rebotado decía «No lo pudimos tomar», como uno informado
// que no se aceptó.
func TestElChequeDeUnaVentaSeVeEnLaFicha(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	var pedido, pago, cheque string
	if err := b.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, total, customer_id)
		values ('PED-1052', 'Sosa', $1, 'mostrador', 'entregado', 287448, $2) returning id`, b.sucursal, b.cliente).Scan(&pedido); err != nil {
		t.Fatal(err)
	}
	_ = b.pool.QueryRow(ctx, `insert into order_payments (order_id, medio, importe) values ($1, 'cheque', 287448) returning id`, pedido).Scan(&pago)
	if err := b.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado, customer_id, order_payment_id, motivo_rechazo)
		values ('recibido', 'fisico', '55500402', 'Banco Sim', now() + interval '20 days', 287448, 'cartera', $1, $2, 'Se endosó a Los Pinos')
		returning id`, b.cliente, pago).Scan(&cheque); err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(b.pool)

	movs, _, err := Historial(ctx, q, b.cliente, nil, "cheques", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(movs) != 1 || movs[0].Clase != "cheque" || movs[0].Importe != nil {
		t.Fatalf("el cheque en cartera de la venta no figura (o mueve la cuenta): %+v", movs)
	}
	// Mientras está en la cartera, la ficha ofrece registrar su rechazo.
	if len(movs[0].Cheques) != 1 || movs[0].Cheques[0].ID != cheque || movs[0].Cheques[0].Importe != 287448 {
		t.Errorf("no ofrece el rechazo: %+v", movs[0].Cheques)
	}

	_, _ = b.pool.Exec(ctx, `update cheques set estado = 'rechazado' where id = $1`, cheque)
	movs, _, err = Historial(ctx, q, b.cliente, nil, "cheques", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(movs) != 1 || movs[0].Clase != "cheque_rechazado" || movs[0].Detalle == nil || *movs[0].Detalle != "Rechazado por el banco" {
		t.Fatalf("rebotado: %+v", movs)
	}
	if len(movs[0].Cheques) != 0 {
		t.Errorf("ofrece rechazar uno ya rechazado: %+v", movs[0].Cheques)
	}
}

// M3S3-081 y M3S3-010: el rechazo de un cheque de una venta es un solo
// renglón (la nota de débito), y uno en la cartera sin vencer se ofrece
// devolver al cliente, no marcar rechazado por el banco.
func TestChequeRechazadoUnRenglonYDevolverSinVencer(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values
		('admin', 'Admin', 'admin@prueba.test', true, now(), now())`)
	admin := sqlc.StaffRoleAdmin
	ses := &auth.Sesion{UserID: "admin", Rol: sqlc.UserRoleStaff, RolStaff: &admin}
	s := Nuevo(b.pool, silencio)
	var pedido, pago, cheque string
	if err := b.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, total, customer_id)
		values ('PED-1103', 'Sosa', $1, 'mostrador', 'entregado', 676000, $2) returning id`, b.sucursal, b.cliente).Scan(&pedido); err != nil {
		t.Fatal(err)
	}
	_ = b.pool.QueryRow(ctx, `insert into order_payments (order_id, medio, importe) values ($1, 'cheque', 676000) returning id`, pedido).Scan(&pago)
	if err := b.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado, customer_id, order_payment_id)
		values ('recibido', 'fisico', '00088123', 'Banco Sim', now() + interval '20 days', 676000, 'cartera', $1, $2)
		returning id`, b.cliente, pago).Scan(&cheque); err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(b.pool)
	movs, _, err := Historial(ctx, q, b.cliente, nil, "cheques", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(movs) != 1 || len(movs[0].Cheques) != 1 || !movs[0].Cheques[0].Devolver {
		t.Fatalf("sin vencer, se ofrece devolver: %+v", movs)
	}
	r, err := s.RechazarConPIN(ctx, ses, cheque, "Lo pidió el cliente", "")
	if err != nil || !strings.HasPrefix(r.Ok, "Devuelto al cliente") {
		t.Fatalf("rechazo: %+v %v", r, err)
	}
	var detalle string
	_ = b.pool.QueryRow(ctx, `select detalle from account_movements where cheque_id = $1 and tipo = 'nota_debito'`, cheque).Scan(&detalle)
	if !strings.Contains(detalle, "devuelto al cliente") {
		t.Errorf("la nota de débito dice %q", detalle)
	}
	movs, _, err = Historial(ctx, q, b.cliente, nil, "cheques", 0)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, m := range movs {
		if m.Clase == "cheque_rechazado" || m.Clase == "nota_debito" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("el rechazo figura %d veces: %+v", n, movs)
	}
}
