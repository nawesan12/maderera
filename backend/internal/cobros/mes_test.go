package cobros

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/auth"
)

// Lo que encontró el mes simulado (noviembre de 2026) en cheques y cobros.

// H405/H424: un diferido no se deposita antes de su fecha de pago.
func TestElDiferidoNoSeDepositaAntes(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('admin', 'Admin', 'admin@prueba.test', true, now(), now())`)
	s := Nuevo(b.pool, silencio)
	ses := &auth.Sesion{UserID: "admin"}
	var diferido, alDia string
	_ = b.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado)
		values ('recibido', 'fisico', '55500901', 'Credicoop', now() + interval '25 days', 400000, 'cartera') returning id`).Scan(&diferido)
	_ = b.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado)
		values ('recibido', 'fisico', '55500902', 'Credicoop', now(), 1000, 'cartera') returning id`).Scan(&alDia)
	if _, err := s.CambiarEstado(ctx, ses, diferido, "depositado", ""); err == nil {
		t.Errorf("el diferido se depositó")
	}
	var estado string
	_ = b.pool.QueryRow(ctx, `select estado::text from cheques where id = $1`, diferido).Scan(&estado)
	if estado != "cartera" {
		t.Errorf("quedó %s", estado)
	}
	if _, err := s.CambiarEstado(ctx, ses, alDia, "depositado", ""); err != nil {
		t.Errorf("el de hoy: %v", err)
	}
}

// H253: la misma referencia de transferencia no cancela dos deudas.
func TestReferenciaDeTransferenciaUsada(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	var otro string
	_ = b.pool.QueryRow(ctx, `insert into customers (nombre) values ('Diego') returning id`).Scan(&otro)
	ref := "Sim-TRF-880101"
	if _, err := emitir(t, b, Cobro{CustomerID: &b.cliente, Origen: "panel", Partes: []Parte{{Medio: "transferencia", Importe: 800000, Referencia: &ref}}}); err != nil {
		t.Fatal(err)
	}
	otra := " sim-trf-880101 "
	_, err := emitir(t, b, Cobro{CustomerID: &otro, Origen: "panel", Partes: []Parte{{Medio: "transferencia", Importe: 1502280, Referencia: &otra}}})
	if err == nil || !strings.Contains(err.Error(), "ya está en el recibo") {
		t.Errorf("la referencia repetida pasó: %v", err)
	}
}
