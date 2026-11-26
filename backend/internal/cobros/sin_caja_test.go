package cobros

import (
	"context"
	"errors"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Mes simulado (H132): desde la ficha, sin ningún turno abierto, un cobro con
// efectivo emitía el recibo y recién después avisaba que el efectivo «no
// entró al arqueo». La plata quedaba en el recibo y en ningún cajón. Ahora se
// frena antes, con la sucursal para abrir la caja, y no queda recibo.
func TestElEfectivoSinCajaAbiertaNoSeCobraDesdeLaFicha(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('admin', 'Admin', 'admin@prueba.test', true, now(), now())`)
	admin := sqlc.StaffRoleAdmin
	ses := &auth.Sesion{UserID: "admin", Rol: sqlc.UserRoleStaff, RolStaff: &admin}
	s := Nuevo(b.pool, silencio)

	// El diálogo lo sabe al abrirse, antes de registrar nada.
	if falta, err := s.CajaDelCobroACuenta(ctx); err != nil || falta == nil || len(falta.Sucursales) == 0 {
		t.Fatalf("al abrir el cobro no dijo qué caja abrir: %v %v", falta, err)
	}

	_, err := s.CobrarAClienteEn(ctx, ses, b.cliente, "", "", `[{"medio":"transferencia","importe":"1000"},{"medio":"efectivo","importe":"300"}]`, "c-1", "")
	var p *plataforma.Problema
	if !errors.As(err, &p) || p.Errores["sinCaja"] == "" && p.Errores["sucursales"] == "" {
		t.Fatalf("sin caja abierta cobró el efectivo: %v", err)
	}
	var recibos int
	_ = b.pool.QueryRow(ctx, `select count(*) from receipts`).Scan(&recibos)
	if recibos != 0 {
		t.Fatalf("quedó un recibo sin caja: %d", recibos)
	}

	// Con la caja abierta, el mismo cobro sale y el efectivo entra al turno.
	var turno string
	_ = b.pool.QueryRow(ctx, `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, 'admin', now()) returning id`, b.sucursal).Scan(&turno)
	if falta, err := s.CajaDelCobroACuenta(ctx); err != nil || falta != nil {
		t.Fatalf("con la única caja abierta pidió abrir otra: %v %v", falta, err)
	}
	r, err := s.CobrarAClienteEn(ctx, ses, b.cliente, "", "", `[{"medio":"transferencia","importe":"1000"},{"medio":"efectivo","importe":"300"}]`, "c-1", b.sucursal)
	if err != nil {
		t.Fatal(err)
	}
	if r.Aviso != nil {
		t.Errorf("con la caja abierta no tendría que avisar: %s", *r.Aviso)
	}
	var enCaja float64
	_ = b.pool.QueryRow(ctx, `select coalesce(sum(monto), 0)::float8 from cash_movements where session_id = $1`, turno).Scan(&enCaja)
	if enCaja != 300 {
		t.Errorf("el efectivo no entró al turno: %v", enCaja)
	}

	// Una transferencia sola no pide caja.
	if _, err := s.CobrarAClienteEn(ctx, ses, b.cliente, "", "", `[{"medio":"transferencia","importe":"50"}]`, "c-2", ""); err != nil {
		t.Errorf("la transferencia sola pidió caja: %v", err)
	}
}
