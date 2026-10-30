package facturacion

import (
	"context"
	"errors"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// El aserradero no factura ni cobra: no abre comprobantes. Antes cualquier
// persona del panel veía cualquiera.
func TestComprobantesSoloParaQuienFacturaOCobra(t *testing.T) {
	a := &API{}
	como := func(r sqlc.StaffRole) context.Context {
		return auth.ConSesion(context.Background(), &auth.Sesion{UserID: "u", Rol: sqlc.UserRoleStaff, RolStaff: &r})
	}
	var p *plataforma.Problema
	if err := a.puedeVer(como(sqlc.StaffRoleAserradero), &Completo{}); !errors.As(err, &p) || p.Estado != 404 {
		t.Fatalf("aserradero: %v", err)
	}
	for _, r := range []sqlc.StaffRole{sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor, sqlc.StaffRoleDeposito} {
		if err := a.puedeVer(como(r), &Completo{}); err != nil {
			t.Errorf("%s: %v", r, err)
		}
	}
}
