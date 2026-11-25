package pagos

import (
	"context"
	"errors"
	"strings"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/cobros"
	"mjbj/internal/plataforma"
)

// Comité del 25/11: el botón «Anular» del panel anulaba también el recibo de
// una deuda pagada por Mercado Pago. La deuda volvía entera con la plata
// todavía en MP (el cliente pagaba dos veces), y el reintegro que llegara
// después se daba por hecho sin asentarse. Ahora el panel lo rechaza y el
// aviso del reintegro sigue anulando el recibo solo, con la deuda de vuelta
// una sola vez.
func TestElPanelNoAnulaElReciboDeUnCobroDeMercadoPago(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre, tipo) values ('Carpintería Oeste', 'particular') returning id`)
	if _, err := e.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, detalle) values ($1, 'ajuste', 50000, 'deuda inicial')`, cliente); err != nil {
		t.Fatal(err)
	}
	pago := e.id(t, `insert into payments (customer_id, tipo, proveedor, monto, estado) values ($1, 'deuda', 'mercado_pago', 50000, 'iniciado') returning id`, cliente)
	monto := 50000.0
	r, err := e.s.Acreditar(ctx, pago, &PagoRemoto{ID: "888", Estado: Aprobado, Monto: &monto, Crudo: []byte(`{}`)})
	if err != nil || r.ReceiptID == nil {
		t.Fatalf("acreditar: %+v %v", r, err)
	}
	saldo := func() float64 {
		return e.numero(t, `select coalesce(sum(monto), 0)::float8 from account_movements where customer_id = $1`, cliente)
	}
	if s := saldo(); s != 0 {
		t.Fatalf("después del pago la cuenta da %v", s)
	}

	usuario := e.id(t, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values (gen_random_uuid()::text, 'Vendedora', 'vende@prueba.test', true, now(), now()) returning id`)
	ses := &auth.Sesion{UserID: usuario, Nombre: "Vendedora"}
	_, err = cobros.Nuevo(e.pool, silencio).Anular(ctx, ses, *r.ReceiptID, "Lo devolvemos")
	var prob *plataforma.Problema
	if !errors.As(err, &prob) || !strings.Contains(prob.Errores["cobro"], "Mercado Pago") {
		t.Fatalf("el panel tenía que rechazar el recibo de MP: %v", err)
	}
	if s := saldo(); s != 0 {
		t.Errorf("el rechazo movió la cuenta: %v", s)
	}
	var estado string
	_ = e.pool.QueryRow(ctx, `select estado::text from receipts where id = $1`, *r.ReceiptID).Scan(&estado)
	if estado != "emitido" {
		t.Errorf("el recibo quedó %s", estado)
	}

	// El reintegro real de MP sí lo anula, y la deuda vuelve una sola vez.
	r2, err := e.s.Acreditar(ctx, pago, &PagoRemoto{ID: "888", Estado: Reintegrado, Monto: &monto, Crudo: []byte(`{}`)})
	if err != nil || !r2.Cambio {
		t.Fatalf("reintegro: %+v %v", r2, err)
	}
	_ = e.pool.QueryRow(ctx, `select estado::text from receipts where id = $1`, *r.ReceiptID).Scan(&estado)
	if estado != "anulado" {
		t.Errorf("con el reintegro el recibo queda %s", estado)
	}
	if s := saldo(); s != 50000 {
		t.Errorf("la deuda tenía que volver una sola vez (50000): da %v", s)
	}
}
