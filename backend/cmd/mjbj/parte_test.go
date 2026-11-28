package main

import (
	"testing"

	"mjbj/internal/reportes"
	"mjbj/internal/sqlc"
)

// El push «Para hoy» (FLUJO-F119): lo urgente primero, hasta tres, y solo
// para el admin.
func TestElParteDelDia(t *testing.T) {
	if _, ok := avisoDelParte(nil); ok {
		t.Error("sin pendientes no hay parte")
	}
	a, ok := avisoDelParte([]reportes.Pendiente{
		{Cantidad: 2, Texto: "pedidos para preparar"},
		{Cantidad: 1, Texto: "cheque que vence hoy", Urgente: true},
	})
	if !ok || a.Titulo != "Para hoy: 1 cosa urgente" || a.Cuerpo != "1 cheque que vence hoy" || a.URL != "/admin" {
		t.Errorf("parte: %+v", a)
	}
	if len(a.Roles) != 1 || a.Roles[0] != sqlc.StaffRoleAdmin {
		t.Errorf("el parte del admin va solo al admin: %v", a.Roles)
	}
}
