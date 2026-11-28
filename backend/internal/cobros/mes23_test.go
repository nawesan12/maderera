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

// Mes 23 (prueba en el navegador, M3S3-043): el listado trae la razón social
// del cliente, para reconocerlo como librador aunque la ficha tenga otro
// nombre.
func TestChequeConLaRazonSocialDelCliente(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	if _, err := b.pool.Exec(ctx, `insert into cheques (sentido, tipo, numero, librador, fecha_pago, importe, estado, circuito, customer_id)
		values ('recibido', 'fisico', '77700001', 'Pérez S.R.L.', now(), 500, 'cartera', 'blanco', $1)`, b.cliente); err != nil {
		t.Fatal(err)
	}
	cs, err := Cheques(ctx, b.pool, "vivos", "")
	if err != nil || len(cs) != 1 {
		t.Fatalf("%v %d", err, len(cs))
	}
	if cs[0].ClienteRazonSocial == nil || *cs[0].ClienteRazonSocial != "Pérez SRL" {
		t.Errorf("razón social: %v", cs[0].ClienteRazonSocial)
	}
}

// Mes 23 (prueba en el navegador): el rechazo de un cheque cargado sin
// cliente no dice que la cuenta del cliente no cambió ni que se le avisó.
func TestRechazoDeUnChequeSinCliente(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('admin', 'Admin', 'admin@prueba.test', true, now(), now())`)
	s := Nuevo(b.pool, silencio)
	ses := &auth.Sesion{UserID: "admin"}
	var id string
	if err := b.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, librador, fecha_pago, importe, estado, circuito)
		values ('recibido', 'fisico', '00045001', 'Un tercero', now(), 120000, 'depositado', 'blanco') returning id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	r, err := s.CambiarEstado(ctx, ses, id, "rechazado", "Sin fondos")
	if err != nil {
		t.Fatal(err)
	}
	if r.Ok != "Rechazado." {
		t.Errorf("mensaje: %q", r.Ok)
	}
}

// Mes 23 (M2S2-040): con «endoso_espera_cae» en «al_cae», la cartera marca
// trabado el cheque de una venta con su factura esperando el CAE; con la de
// arranque, no.
func TestCarteraConElChequeQueEsperaElCAE(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	var pedido, pago string
	_ = b.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, origen, estado, total) values ('PED-1165', 'DEP2', 'mostrador', 'entregado', 1000) returning id`).Scan(&pedido)
	_ = b.pool.QueryRow(ctx, `insert into order_payments (order_id, medio, importe) values ($1, 'cheque', 1000) returning id`, pedido).Scan(&pago)
	if _, err := b.pool.Exec(ctx, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, order_id)
		values ('factura_a', 15, 9, 'DEP2', 826.45, 173.55, 0, 0, 0, 1000, 'emitida', now(), $1)`, pedido); err != nil {
		t.Fatal(err)
	}
	if _, err := b.pool.Exec(ctx, `insert into cheques (sentido, tipo, numero, fecha_pago, importe, estado, circuito, order_payment_id)
		values ('recibido', 'fisico', '00077001', now(), 1000, 'cartera', 'blanco', $1)`, pago); err != nil {
		t.Fatal(err)
	}
	for _, caso := range []struct {
		regla   string
		trabado bool
	}{{"si", false}, {"al_cae", true}} {
		if _, err := b.pool.Exec(ctx, `insert into site_settings (clave, valor) values ('endoso_espera_cae', $1) on conflict (clave) do update set valor = excluded.valor`, caso.regla); err != nil {
			t.Fatal(err)
		}
		cs, err := EnCartera(ctx, b.pool)
		if err != nil || len(cs) != 1 {
			t.Fatalf("%v %d", err, len(cs))
		}
		if !cs[0].EsperaCae || cs[0].Trabado != caso.trabado {
			t.Errorf("%s: espera %v trabado %v", caso.regla, cs[0].EsperaCae, cs[0].Trabado)
		}
	}
}

// M2S3-088: el cheque de la cartera que entró con un recibo y se le devuelve
// al cliente encola su propio aviso, con la cuenta que cambió; el informado
// que no se tomó sigue con el suyo.
func TestElChequeDevueltoEncolaSuAviso(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('admin', 'Admin', 'admin@prueba.test', true, now(), now())`)
	_, _ = b.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto) values ($1, 'compra', 300000)`, b.cliente)
	s := Nuevo(b.pool, silencio)
	ses := &auth.Sesion{UserID: "admin"}
	if _, err := emitir(t, b, Cobro{CustomerID: &b.cliente, Origen: "panel", Partes: []Parte{
		{Medio: "cheque", Importe: 300000, Cheque: &ChequeNuevo{Numero: "00061001", Banco: "Santander", FechaPago: time.Now()}},
	}}); err != nil {
		t.Fatal(err)
	}
	var id string
	_ = b.pool.QueryRow(ctx, `select id from cheques where numero = '00061001'`).Scan(&id)
	r, err := s.CambiarEstado(ctx, ses, id, "rechazado", "Lo pidió de vuelta")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(r.Ok, "Devuelto al cliente") {
		t.Errorf("mensaje: %q", r.Ok)
	}
	var carga string
	_ = b.pool.QueryRow(ctx, `select carga::text from trabajos where tipo = $1`, TrabajoChequeRechazado).Scan(&carga)
	if !strings.Contains(carga, `"devuelto": true`) || !strings.Contains(carga, `"volvioALaCuenta": true`) || !strings.Contains(carga, `"porElBanco": false`) {
		t.Errorf("carga: %s", carga)
	}
	if s := saldo(t, b); s != 300000 {
		t.Errorf("la deuda vuelve: %v", s)
	}
}

// Mes 23: anular el pago que endosaba un cheque lo devuelve a la cartera, y
// su tarjeta ya no dice «entregado a» ese proveedor.
func TestElChequeDeUnPagoAnuladoNoFiguraEntregado(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	var cheque, prov, pago string
	_ = b.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, fecha_pago, importe, estado, circuito, customer_id)
		values ('recibido', 'fisico', '00077001', now(), 362000, 'cartera', 'blanco', $1) returning id`, b.cliente).Scan(&cheque)
	_ = b.pool.QueryRow(ctx, `insert into suppliers (nombre) values ('V3 Placas Costa') returning id`).Scan(&prov)
	_ = b.pool.QueryRow(ctx, `insert into supplier_payments (supplier_id, total, neto, medio, anulado_at) values ($1, 362000, 362000, 'cheque', now()) returning id`, prov).Scan(&pago)
	if _, err := b.pool.Exec(ctx, `insert into supplier_payment_parts (payment_id, medio, importe, cheque_id) values ($1, 'cheque', 362000, $2)`, pago, cheque); err != nil {
		t.Fatal(err)
	}
	cs, err := Cheques(ctx, b.pool, "vivos", "")
	if err != nil || len(cs) != 1 {
		t.Fatalf("%v %d", err, len(cs))
	}
	if cs[0].Proveedor != nil {
		t.Errorf("sigue entregado a %s", *cs[0].Proveedor)
	}
	// Endosado de nuevo en un pago vivo, sí.
	var otro string
	_ = b.pool.QueryRow(ctx, `insert into supplier_payments (supplier_id, total, neto, medio) values ($1, 362000, 362000, 'cheque') returning id`, prov).Scan(&otro)
	_, _ = b.pool.Exec(ctx, `insert into supplier_payment_parts (payment_id, medio, importe, cheque_id) values ($1, 'cheque', 362000, $2)`, otro, cheque)
	_, _ = b.pool.Exec(ctx, `update cheques set estado = 'entregado' where id = $1`, cheque)
	cs, _ = Cheques(ctx, b.pool, "vivos", "")
	if len(cs) != 1 || cs[0].Proveedor == nil || *cs[0].Proveedor != "V3 Placas Costa" {
		t.Errorf("endosado: %+v", cs)
	}
}
