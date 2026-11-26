package cobros

import (
	"context"
	"errors"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Mes simulado (H278): la vendedora anulaba un recibo con el motivo solo.
// Ahora pide el PIN de un admin, como anular una venta; el admin firma solo.
func TestAnularUnReciboPideElPINAQuienNoEsAdmin(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values
		('admin', 'Admin', 'admin@prueba.test', true, now(), now()), ('vende', 'Vende', 'vende@prueba.test', true, now(), now())`)
	admin, vendedor := sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor
	sesAdmin := &auth.Sesion{UserID: "admin", Rol: sqlc.UserRoleStaff, RolStaff: &admin}
	sesVende := &auth.Sesion{UserID: "vende", Rol: sqlc.UserRoleStaff, RolStaff: &vendedor}
	s := Nuevo(b.pool, silencio)

	r, err := s.CobrarAClienteEn(ctx, sesVende, b.cliente, "", "", `[{"medio":"transferencia","importe":"1880100"}]`, "c-1", "")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Anular(ctx, sesVende, *r.ReceiptID, "Se cargó mal")
	var p *plataforma.Problema
	if !errors.As(err, &p) || p.Errores["pin"] == "" {
		t.Fatalf("la vendedora anuló sin PIN: %v", err)
	}
	var estado string
	_ = b.pool.QueryRow(ctx, `select estado::text from receipts where id = $1`, *r.ReceiptID).Scan(&estado)
	if estado != "emitido" {
		t.Fatalf("el recibo quedó %s", estado)
	}
	if _, err := s.Anular(ctx, sesAdmin, *r.ReceiptID, "Se cargó mal"); err != nil {
		t.Fatalf("el admin no pudo anular: %v", err)
	}
}
