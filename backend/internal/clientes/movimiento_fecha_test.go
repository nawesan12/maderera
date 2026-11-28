package clientes

import (
	"context"
	"errors"
	"testing"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/pruebas"
)

// M3S3-017: la deuda vieja que se carga hoy lleva su fecha; para adelante,
// no. Y el teléfono tipeado de corrido se guarda como las demás fichas
// (M3S1-069).
func TestMovimientoConFechaYTelefono(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, silencio)
	ses := &auth.Sesion{UserID: "nadie", Nombre: "Dueña"}
	id, _, err := s.GuardarConID(ctx, ses, FormCliente{Nombre: "Sim Herrería del Faro", Telefono: "2235550483"})
	if err != nil {
		t.Fatal(err)
	}
	var tel string
	_ = pool.QueryRow(ctx, `select telefono from customers where id = $1`, id).Scan(&tel)
	if tel != "223 555-0483" {
		t.Errorf("teléfono: %q", tel)
	}

	hoy := time.Now().In(argentina)
	octubre := hoy.AddDate(0, -1, -5).Format("2006-01-02")
	if err := s.Movimiento(ctx, ses, id, "nota_debito", "180000", "Sim saldo del sistema viejo", octubre); err != nil {
		t.Fatal(err)
	}
	var dia string
	_ = pool.QueryRow(ctx, `select to_char(created_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') from account_movements where customer_id = $1`, id).Scan(&dia)
	if dia != octubre {
		t.Errorf("fecha guardada %s, quería %s", dia, octubre)
	}
	manana := hoy.AddDate(0, 0, 1).Format("2006-01-02")
	err = s.Movimiento(ctx, ses, id, "nota_debito", "1", "", manana)
	var p *plataforma.Problema
	if !errors.As(err, &p) {
		t.Errorf("una fecha de mañana se aceptó: %v", err)
	}
	// Sin fecha, hoy, como siempre.
	if err := s.Movimiento(ctx, ses, id, "ajuste", "1000", ""); err != nil {
		t.Fatal(err)
	}
}
