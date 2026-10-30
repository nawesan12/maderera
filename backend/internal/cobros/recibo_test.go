package cobros

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

type base struct {
	pool              *pgxpool.Pool
	cliente, sucursal string
}

func armarBase(t *testing.T) base {
	t.Helper()
	pool := pruebas.Base(t)
	ctx := context.Background()
	var b base
	b.pool = pool
	_ = pool.QueryRow(ctx, `insert into customers (nombre, razon_social) values ('Juan Pérez', 'Pérez SRL') returning id`).Scan(&b.cliente)
	_ = pool.QueryRow(ctx, `insert into branches (slug, name) values ('casa-central', 'Casa Central') returning id`).Scan(&b.sucursal)
	return b
}

func emitir(t *testing.T, b base, c Cobro) (ReciboEmitido, error) {
	t.Helper()
	var r ReciboEmitido
	err := pgx.BeginFunc(context.Background(), b.pool, func(tx pgx.Tx) error {
		var err error
		r, err = EmitirRecibo(context.Background(), tx, c)
		return err
	})
	return r, err
}

func saldo(t *testing.T, b base) float64 {
	var s float64
	_ = b.pool.QueryRow(context.Background(), `select coalesce(sum(monto), 0)::float8 from account_movements where customer_id = $1`, b.cliente).Scan(&s)
	return s
}

func TestReciboConChequeYEfectivo(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	var turno string
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('cajera', 'Cajera', 'cajera@prueba.test', true, now(), now())`)
	if err := b.pool.QueryRow(ctx, `insert into cash_sessions (branch_id, abierta_por) values ($1, 'cajera') returning id`, b.sucursal).Scan(&turno); err != nil {
		t.Fatal(err)
	}
	_, _ = b.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto) values ($1, 'compra', 300000)`, b.cliente)

	fecha := time.Date(2026, 11, 1, 12, 0, 0, 0, argentina)
	partes := []Parte{
		{Medio: "efectivo", Importe: 100000.004},
		{Medio: "cheque", Importe: 150000, Cheque: &ChequeNuevo{Numero: " 0012-3456 ", Banco: " Nación ", FechaPago: fecha}},
		{Medio: "transferencia", Importe: 50000, Referencia: ptr("  op 99  ")},
	}
	r, err := emitir(t, b, Cobro{CustomerID: &b.cliente, BranchID: &b.sucursal, Origen: "panel", Partes: partes, Caja: &Caja{Buscar: true}})
	if err != nil {
		t.Fatal(err)
	}
	if r.Numero != "REC-0001" || r.Total != 300000 || r.AccountMovementID == nil || r.Aviso != nil {
		t.Fatalf("recibo: %+v", r)
	}
	if s := saldo(t, b); s != 0 {
		t.Errorf("saldo después de pagar todo: %v", s)
	}
	var recibidoDe, caja, cheque string
	_ = b.pool.QueryRow(ctx, `select recibido_de from receipts where id = $1`, r.ReceiptID).Scan(&recibidoDe)
	_ = b.pool.QueryRow(ctx, `select monto::text || ' ' || motivo from cash_movements where session_id = $1`, turno).Scan(&caja)
	_ = b.pool.QueryRow(ctx, `select numero || ' ' || banco || ' ' || estado::text || ' ' || importe::text from cheques`).Scan(&cheque)
	if recibidoDe != "Pérez SRL" || caja != "100000.00 Recibo REC-0001 — Pérez SRL" || cheque != "00123456 Nación cartera 150000.00" {
		t.Errorf("recibido de %q, caja %q, cheque %q", recibidoDe, caja, cheque)
	}

	// El mismo cheque otra vez: el motivo dice cuál es.
	_, err = emitir(t, b, Cobro{CustomerID: &b.cliente, Origen: "panel", Partes: []Parte{
		{Medio: "cheque", Importe: 1000, Cheque: &ChequeNuevo{Numero: "00123456", Banco: "NACIÓN", FechaPago: fecha}},
	}})
	var ec *ErrorDeCobro
	// «NACIÓN» con tilde mayúscula: lower() de Postgres la baja igual y lo
	// encuentra; el mensaje nombra el banco como lo escribió la persona.
	if !errors.As(err, &ec) || ec.Mensaje != "Cheque NACIÓN N° 00123456 ya está cargado. Buscalo en la cartera." {
		t.Errorf("cheque repetido: %v", err)
	}

	// Anular: la deuda vuelve, el cheque en cartera se anula.
	if err := pgx.BeginFunc(ctx, b.pool, func(tx pgx.Tx) error {
		_, _, err := AnularRecibo(ctx, tx, r.ReceiptID, "lo cargué mal", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if s := saldo(t, b); s != 300000 {
		t.Errorf("saldo después de anular: %v", s)
	}
	var estado string
	_ = b.pool.QueryRow(ctx, `select estado::text from cheques`).Scan(&estado)
	if estado != "anulado" {
		t.Errorf("el cheque del recibo anulado quedó %s", estado)
	}
	err = pgx.BeginFunc(ctx, b.pool, func(tx pgx.Tx) error {
		_, _, err := AnularRecibo(ctx, tx, r.ReceiptID, "otra vez", nil)
		return err
	})
	if !errors.As(err, &ec) || ec.Mensaje != "Ese recibo ya estaba anulado." {
		t.Errorf("anular dos veces: %v", err)
	}
}

func TestAnularConChequeDepositado(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	r, err := emitir(t, b, Cobro{CustomerID: &b.cliente, Origen: "panel", Partes: []Parte{
		{Medio: "cheque", Importe: 500, Cheque: &ChequeNuevo{Numero: "77778888", Banco: "Galicia", FechaPago: time.Now()}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = b.pool.Exec(ctx, `update cheques set estado = 'depositado'`)
	err = pgx.BeginFunc(ctx, b.pool, func(tx pgx.Tx) error {
		_, _, err := AnularRecibo(ctx, tx, r.ReceiptID, "x", nil)
		return err
	})
	var ec *ErrorDeCobro
	if !errors.As(err, &ec) || !strings.Contains(ec.Mensaje, "ya salió de la cartera") {
		t.Errorf("anular con un cheque depositado: %v", err)
	}
	// Sin caja abierta, el efectivo no frena el cobro: avisa.
	r, err = emitir(t, b, Cobro{CustomerID: &b.cliente, Origen: "panel", Partes: []Parte{{Medio: "efectivo", Importe: 10}}, Caja: &Caja{Buscar: true}})
	if err != nil || r.Aviso == nil || !strings.Contains(*r.Aviso, "No hay ninguna caja abierta") {
		t.Errorf("sin caja: %+v %v", r, err)
	}
}

// Bug: un cheque en cartera que entró con un recibo se podía anular suelto.
// El cheque dejaba de contar pero la deuda que pagó seguía cancelada: plata
// que no entró nunca. Ahora hay que anular el recibo, que devuelve la deuda.
func TestAnularChequeDeUnReciboSeBloquea(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('admin', 'Admin', 'admin@prueba.test', true, now(), now())`)
	_, _ = b.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto) values ($1, 'compra', 500)`, b.cliente)
	r, err := emitir(t, b, Cobro{CustomerID: &b.cliente, Origen: "panel", Partes: []Parte{
		{Medio: "cheque", Importe: 500, Cheque: &ChequeNuevo{Numero: "55556666", Banco: "Galicia", FechaPago: time.Now()}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	var cheque string
	_ = b.pool.QueryRow(ctx, `select id from cheques`).Scan(&cheque)
	s := Nuevo(b.pool, silencio)
	ses := &auth.Sesion{UserID: "admin"}
	_, err = s.CambiarEstado(ctx, ses, cheque, "anulado", "")
	var p *plataforma.Problema
	if !errors.As(err, &p) || !strings.Contains(p.Errores["cobro"], "anulá el recibo "+r.Numero) {
		t.Errorf("anular suelto un cheque de un recibo: %v", err)
	}
	if sd := saldo(t, b); sd != 0 {
		t.Errorf("la deuda no se mueve: %v", sd)
	}
	var estado string
	_ = b.pool.QueryRow(ctx, `select estado::text from cheques`).Scan(&estado)
	if estado != "cartera" {
		t.Errorf("el cheque sigue en cartera: %s", estado)
	}
	// Un cheque cargado a mano, sin recibo, se sigue pudiendo anular.
	var suelto string
	_ = b.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado, customer_id)
		values ('recibido', 'fisico', '99990000', 'Nación', now(), 100, 'cartera', $1) returning id`, b.cliente).Scan(&suelto)
	if _, err := s.CambiarEstado(ctx, ses, suelto, "anulado", ""); err != nil {
		t.Errorf("anular un cheque sin recibo: %v", err)
	}
}

// Bug: el cheque con que se pagó una venta del mostrador (sin recibo, atado
// al renglón del pago) se podía anular suelto: la venta seguía cobrada y la
// mercadería entregada con un cheque que ya no contaba. Ahora manda a anular
// la venta desde el mostrador; con la venta ya anulada, no frena.
func TestAnularChequeDeUnaVentaDelMostradorSeBloquea(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('admin', 'Admin', 'admin@prueba.test', true, now(), now())`)
	var pedido, renglon, cheque string
	if err := b.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, branch_id, origen, estado, total, customer_id)
		values ('M-0042', 'Mostrador', $1, 'mostrador', 'entregado', 800, $2) returning id`, b.sucursal, b.cliente).Scan(&pedido); err != nil {
		t.Fatal(err)
	}
	if err := b.pool.QueryRow(ctx, `insert into order_payments (order_id, medio, importe) values ($1, 'cheque', 800) returning id`, pedido).Scan(&renglon); err != nil {
		t.Fatal(err)
	}
	if err := b.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado, customer_id, order_payment_id)
		values ('recibido', 'fisico', '12340000', 'Macro', now(), 800, 'cartera', $1, $2) returning id`, b.cliente, renglon).Scan(&cheque); err != nil {
		t.Fatal(err)
	}
	s := Nuevo(b.pool, silencio)
	ses := &auth.Sesion{UserID: "admin"}
	_, err := s.CambiarEstado(ctx, ses, cheque, "anulado", "")
	var p *plataforma.Problema
	if !errors.As(err, &p) || !strings.Contains(p.Errores["cobro"], "anulá la venta M-0042 desde el mostrador") {
		t.Errorf("anular suelto un cheque de una venta: %v", err)
	}
	var estado string
	_ = b.pool.QueryRow(ctx, `select estado::text from cheques where id = $1`, cheque).Scan(&estado)
	if estado != "cartera" {
		t.Errorf("el cheque sigue en cartera: %s", estado)
	}
	// Con la venta anulada en el mostrador, el cheque ya no frena nada.
	_, _ = b.pool.Exec(ctx, `update orders set estado = 'cancelado' where id = $1`, pedido)
	if _, err := s.CambiarEstado(ctx, ses, cheque, "anulado", ""); err != nil {
		t.Errorf("con la venta anulada, el cheque se anula: %v", err)
	}
}

// Bug: el saldo se sumaba en coma flotante y un saldo real cero daba
// -5,5e-17: con límite cero, el cliente «tenía $ 0 a favor y no alcanzaba».
func TestCreditoConSaldoCeroNoTieneNadaAFavor(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, created_at) values
		($1, 'pago', -0.1, now() - interval '3 days'), ($1, 'pago', -0.2, now() - interval '2 days'), ($1, 'compra', 0.3, now() - interval '1 day')`, b.cliente)
	e, err := Credito(ctx, sqlc.New(b.pool), b.cliente, 100, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if e.Saldo != 0 || e.SoloSaldoAFavor || e.Motivo == nil || *e.Motivo != "Este cliente no tiene cuenta corriente habilitada." {
		t.Errorf("saldo cero: %+v %v", e, *e.Motivo)
	}
}

// Veinte cobros a la vez: los números salen seguidos, sin huecos ni
// repetidos (el candado de la serie es el mismo que el del TS).
func TestNumeracionConcurrente(t *testing.T) {
	b := armarBase(t)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var numeros []string
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := emitir(t, b, Cobro{CustomerID: &b.cliente, Origen: "panel", Partes: []Parte{{Medio: "transferencia", Importe: 1}}})
			if err != nil {
				t.Error(err)
				return
			}
			mu.Lock()
			numeros = append(numeros, r.Numero)
			mu.Unlock()
		}()
	}
	wg.Wait()
	sort.Strings(numeros)
	for i, n := range numeros {
		if n != fmt.Sprintf("REC-%04d", i+1) {
			t.Fatalf("numeración: %v", numeros)
		}
	}
}

func ptr(s string) *string { return &s }
