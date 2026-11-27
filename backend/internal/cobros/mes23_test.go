package cobros

import (
	"context"
	"strings"
	"testing"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/ventas/fragmentos"
)

// M2S3-088: un cheque de la cartera que se le devuelve al cliente dice eso
// en la cuenta, y en la cartera figura como devuelto (no como rechazado
// por el banco).
func TestChequeDevueltoDesdeLaCartera(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('admin', 'Admin', 'admin@prueba.test', true, now(), now())`)
	s := Nuevo(b.pool, silencio)
	ses := &auth.Sesion{UserID: "admin"}
	_, _ = b.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto) values ($1, 'compra', 500)`, b.cliente)
	if _, err := emitir(t, b, Cobro{CustomerID: &b.cliente, Origen: "panel", Partes: []Parte{
		{Medio: "cheque", Importe: 500, Cheque: &ChequeNuevo{Numero: "88123000", Banco: "Galicia", FechaPago: time.Now().AddDate(0, 0, 20)}},
	}}); err != nil {
		t.Fatal(err)
	}
	var id string
	_ = b.pool.QueryRow(ctx, `select id from cheques where numero = '88123000'`).Scan(&id)
	r, err := s.CambiarEstado(ctx, ses, id, "rechazado", "Lo pidió el cliente")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(r.Ok, "Devuelto") {
		t.Errorf("mensaje: %q", r.Ok)
	}
	var detalle string
	_ = b.pool.QueryRow(ctx, `select detalle from account_movements where cheque_id = $1 and tipo = 'nota_debito'`, id).Scan(&detalle)
	if !strings.Contains(detalle, "devuelto al cliente") {
		t.Errorf("detalle: %q", detalle)
	}
	cheques, err := Cheques(ctx, b.pool, "todos", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cheques {
		if c.ID == id && (!c.Devuelto || c.NoAceptado) {
			t.Errorf("en la cartera: %+v", c)
		}
	}
}

// M3S3-005: el cheque de un recibo que el reparto mandó entero al B es del
// B (antes su acreditación salía del A).
func TestChequeDeUnReciboEnteroEnElB(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	if _, err := emitir(t, b, Cobro{CustomerID: &b.cliente, Origen: "panel", Partes: []Parte{
		{Medio: "cheque", Importe: 68800, Cheque: &ChequeNuevo{Numero: "10400100", Banco: "Nación", FechaPago: time.Now()}},
	}}); err != nil {
		t.Fatal(err)
	}
	var id string
	_ = b.pool.QueryRow(ctx, `select id from cheques where numero = '10400100'`).Scan(&id)
	// Un recibo de antes de la 00370, sin el circuito del reparto guardado en
	// el cheque: se lee por el reparto del recibo. Con la columna, manda
	// ella (la fija cobros.FijarReparto al emitir).
	_, _ = b.pool.Exec(ctx, `update cheques set circuito_reparto = null where id = $1`, id)
	_, _ = b.pool.Exec(ctx, `update receipts set reparto_deudores = 0, reparto_anticipo = 0, reparto_b = 68800
		where id = (select receipt_id from cheques where id = $1)`, id)
	var circuito string
	if err := b.pool.QueryRow(ctx, `select `+fragmentos.CircuitoDelCheque("ch")+` from cheques ch where ch.id = $1`, id).Scan(&circuito); err != nil {
		t.Fatal(err)
	}
	if circuito != "negro" {
		t.Errorf("circuito: %s", circuito)
	}
	_, _ = b.pool.Exec(ctx, `update receipts set reparto_deudores = 68800, reparto_b = 0 where id = (select receipt_id from cheques where id = $1)`, id)
	_ = b.pool.QueryRow(ctx, `select `+fragmentos.CircuitoDelCheque("ch")+` from cheques ch where ch.id = $1`, id).Scan(&circuito)
	if circuito != "blanco" {
		t.Errorf("con el reparto al blanco: %s", circuito)
	}
	_, _ = b.pool.Exec(ctx, `update cheques set circuito_reparto = 'negro' where id = $1`, id)
	_ = b.pool.QueryRow(ctx, `select `+fragmentos.CircuitoDelCheque("ch")+` from cheques ch where ch.id = $1`, id).Scan(&circuito)
	if circuito != "negro" {
		t.Errorf("con el circuito del reparto guardado: %s", circuito)
	}
}
