package cuentas

import (
	"context"
	"errors"
	"testing"

	"mjbj/internal/api/cuentasapi"
	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

func comoRol(r sqlc.StaffRole) context.Context {
	return auth.ConSesion(context.Background(), &auth.Sesion{UserID: "u", Rol: sqlc.UserRoleStaff, RolStaff: &r})
}

// El aserradero no cobra: no abre recibos (ni el JSON ni el PDF) ni el
// resumen de cuenta de un cliente. Antes cualquier persona del panel veía
// cualquiera.
func TestRecibosSoloParaQuienCobra(t *testing.T) {
	a := &API{}
	var p *plataforma.Problema
	_, err := a.ReciboCompleto(comoRol(sqlc.StaffRoleAserradero), cuentasapi.ReciboCompletoRequestObject{})
	if !errors.As(err, &p) || p.Estado != 404 {
		t.Fatalf("aserradero, recibo: %v", err)
	}
	sinDueno := func() (*string, error) { return nil, nil }
	if err := a.puedeVer(comoRol(sqlc.StaffRoleAserradero), pantallaDelRecibo, sinDueno); !errors.As(err, &p) || p.Estado != 404 {
		t.Fatalf("aserradero, PDF del recibo: %v", err)
	}
	if err := a.puedeVer(comoRol(sqlc.StaffRoleDeposito), "/admin/clientes", sinDueno); !errors.As(err, &p) || p.Estado != 404 {
		t.Fatalf("depósito, resumen de cuenta: %v", err)
	}
	for _, r := range []sqlc.StaffRole{sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor, sqlc.StaffRoleDeposito} {
		if err := a.puedeVer(comoRol(r), pantallaDelRecibo, sinDueno); err != nil {
			t.Errorf("%s, PDF del recibo: %v", r, err)
		}
	}
}
