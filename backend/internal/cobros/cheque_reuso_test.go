package cobros

import (
	"context"
	"testing"
	"time"
)

// Un cheque que ya entró por un recibo no puede cancelar deuda otra vez, ni
// del mismo cliente ni de otro.
func TestChequeDeLaCarteraNoSeReusa(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	var otro string
	if err := b.pool.QueryRow(ctx, `insert into customers (nombre) values ('Otro') returning id`).Scan(&otro); err != nil {
		t.Fatal(err)
	}
	fecha := time.Date(2026, 11, 20, 12, 0, 0, 0, argentina)
	r1, err := emitir(t, b, Cobro{CustomerID: &b.cliente, Origen: "panel", Partes: []Parte{{Medio: "cheque", Importe: 100000, Cheque: &ChequeNuevo{Numero: "12345678", Banco: "Nación", FechaPago: fecha}}}})
	if err != nil {
		t.Fatal(err)
	}
	var ch string
	if err := b.pool.QueryRow(ctx, `select id from cheques where receipt_id = $1`, r1.ReceiptID).Scan(&ch); err != nil {
		t.Fatal(err)
	}
	for _, quien := range []*string{&otro, &b.cliente} {
		if _, err := emitir(t, b, Cobro{CustomerID: quien, Origen: "mostrador", Partes: []Parte{{Medio: "cheque", Importe: 100000, ChequeID: &ch}}}); err == nil {
			t.Fatalf("el cheque %s se volvió a usar para %s", ch, *quien)
		}
	}
	var s float64
	_ = b.pool.QueryRow(ctx, `select coalesce(sum(monto),0)::float8 from account_movements where customer_id=$1`, otro).Scan(&s)
	if s != 0 {
		t.Fatalf("la cuenta del otro cliente se movió: %v", s)
	}
}
