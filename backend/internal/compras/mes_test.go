package compras

import (
	"context"
	"testing"
	"time"
)

// Las pruebas de lo que encontró el mes simulado en producción (noviembre
// de 2026), cada una con el id del hallazgo.

func (e *entorno) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func (e *entorno) id(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var id string
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return id
}

// H005/H061: una factura que vence hoy no está vencida en Facturas de compra.
func TestFacturaQueVenceHoyNoEstaVencida(t *testing.T) {
	e := armar(t)
	e.exec(t, `insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, neto, iva21, iva105, iva27, percepciones, total, fecha_emision, fecha_vencimiento)
		values ($1, 'factura_a', 4, 1877, 800, 0, 0, 0, 0, 800, '2026-11-26T00:00:00Z', '2026-11-26T00:00:00Z')`, e.proveedor)
	s := Nuevo(e.pool, silencio)
	arg := zonaArgentina
	for _, ahora := range []time.Time{time.Date(2026, 11, 26, 0, 40, 0, 0, arg), time.Date(2026, 11, 26, 23, 50, 0, 0, arg)} {
		l, err := s.ListarFacturas(context.Background(), FiltroDeFacturas{Estado: "pendiente"}, ahora)
		if err != nil {
			t.Fatal(err)
		}
		if l.Vencidas != 0 || l.ImpagoVencido != 0 || l.Impagas != 1 {
			t.Errorf("%v: %+v", ahora, l)
		}
	}
	l, _ := s.ListarFacturas(context.Background(), FiltroDeFacturas{Estado: "pendiente"}, time.Date(2026, 11, 27, 0, 5, 0, 0, arg))
	if l.Vencidas != 1 || l.ImpagoVencido != 800 {
		t.Errorf("al otro día: %+v", l)
	}
}

// H143: un número de cheque con letras se rechaza en vez de perderlas.
func TestNumeroDeChequeConLetras(t *testing.T) {
	for _, n := range []string{"E-55500777", "Sim-CP-000101"} {
		if RevisarNumeroDeCheque(n) == "" {
			t.Errorf("%s pasó", n)
		}
	}
	for _, n := range []string{"0012-3456", "12 345 678", "55500777"} {
		if p := RevisarNumeroDeCheque(n); p != "" {
			t.Errorf("%s: %s", n, p)
		}
	}
}
