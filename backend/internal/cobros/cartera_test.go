package cobros

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
)

// Bug: rechazar un cheque cargado a mano con un cliente le sumaba a ese
// cliente una nota de débito, aunque el cheque nunca le había bajado la
// deuda (el alta manual no emite recibo). Ahora solo debita el que contaba:
// el que entró con un recibo. Y el alta manual ya no acepta un cliente: ese
// cheque se carga cobrándole.
func TestRechazarSoloDebitaElChequeQueBajoLaDeuda(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('admin', 'Admin', 'admin@prueba.test', true, now(), now())`)
	s := Nuevo(b.pool, silencio)
	ses := &auth.Sesion{UserID: "admin"}

	var suelto string
	_ = b.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado, customer_id)
		values ('recibido', 'fisico', '11112222', 'Nación', now(), 300, 'cartera', $1) returning id`, b.cliente).Scan(&suelto)
	if _, err := s.CambiarEstado(ctx, ses, suelto, "depositado", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CambiarEstado(ctx, ses, suelto, "rechazado", "Sin fondos"); err != nil {
		t.Fatal(err)
	}
	if sd := saldo(t, b); sd != 0 {
		t.Errorf("el cheque suelto no toca la cuenta: %v", sd)
	}

	// El que entró con un recibo sí: la deuda vuelve.
	_, _ = b.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto) values ($1, 'compra', 500)`, b.cliente)
	if _, err := emitir(t, b, Cobro{CustomerID: &b.cliente, Origen: "panel", Partes: []Parte{
		{Medio: "cheque", Importe: 500, Cheque: &ChequeNuevo{Numero: "33334444", Banco: "Galicia", FechaPago: time.Now()}},
	}}); err != nil {
		t.Fatal(err)
	}
	var conRecibo string
	_ = b.pool.QueryRow(ctx, `select id from cheques where numero = '33334444'`).Scan(&conRecibo)
	if _, err := s.CambiarEstado(ctx, ses, conRecibo, "rechazado", "Firma"); err != nil {
		t.Fatal(err)
	}
	if sd := saldo(t, b); sd != 500 {
		t.Errorf("la deuda vuelve con el cheque del recibo: %v", sd)
	}

	// El alta manual con cliente no se acepta; sin cliente, sí.
	err := s.CargarCheque(ctx, ses, FormCheque{Sentido: "recibido", Numero: "55556666", Banco: "Nación", FechaPago: "2026-12-01",
		Importe: "100", CustomerID: b.cliente})
	var p *plataforma.Problema
	if !errors.As(err, &p) || !strings.Contains(p.Errores["customerId"], "cobrándole") {
		t.Errorf("alta con cliente: %v", err)
	}
	if err := s.CargarCheque(ctx, ses, FormCheque{Sentido: "recibido", Numero: "55556666", Banco: "Nación", FechaPago: "2026-12-01", Importe: "100"}); err != nil {
		t.Errorf("alta sin cliente: %v", err)
	}
}

// Los terminados van de a páginas, lo último primero, y el proveedor de un
// cheque que salió en dos pagos (el primero anulado) aparece una vez, con el
// pago que vale.
func TestChequesTerminadosYProveedor(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	for i, n := range []string{"10000001", "10000002", "10000003"} {
		_, _ = b.pool.Exec(ctx, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado, updated_at)
			values ('recibido', $1, 'Nación', now(), 10, 'acreditado', now() - make_interval(days => $2))`, n, i)
	}
	var vivo string
	_ = b.pool.QueryRow(ctx, `insert into cheques (sentido, numero, banco, fecha_pago, importe, estado)
		values ('recibido', '20000001', 'Nación', now(), 10, 'entregado') returning id`).Scan(&vivo)
	var viejo, nuevo string
	_ = b.pool.QueryRow(ctx, `insert into suppliers (nombre) values ('Viejo') returning id`).Scan(&viejo)
	_ = b.pool.QueryRow(ctx, `insert into suppliers (nombre) values ('Nuevo') returning id`).Scan(&nuevo)
	for _, x := range []struct {
		prov    string
		anulado any
	}{{viejo, time.Now()}, {nuevo, nil}} {
		var pago string
		_ = b.pool.QueryRow(ctx, `insert into supplier_payments (supplier_id, total, neto, anulado_at) values ($1, 10, 10, $2) returning id`, x.prov, x.anulado).Scan(&pago)
		if _, err := b.pool.Exec(ctx, `insert into supplier_payment_parts (payment_id, medio, importe, cheque_id) values ($1, 'cheque_tercero', 10, $2)`, pago, vivo); err != nil {
			t.Fatal(err)
		}
	}

	filas, total, err := ChequesTerminados(ctx, b.pool, 2, 1)
	if err != nil {
		t.Fatal(err)
	}
	if total != 3 || len(filas) != 2 || filas[0].Numero != "10000002" || filas[1].Numero != "10000003" {
		t.Errorf("segunda página: %d %+v", total, filas)
	}
	vivos, err := Cheques(ctx, b.pool, "vivos", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(vivos) != 1 || vivos[0].ProveedorID == nil || *vivos[0].ProveedorID != nuevo || *vivos[0].Proveedor != "Nuevo" {
		t.Errorf("vivos: %+v", vivos)
	}
}
