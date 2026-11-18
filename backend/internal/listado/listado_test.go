package listado

import (
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/sqlc"
)

// El filtro por proveedor queda solo para quien entra a Compras.
func TestSoloQuienCompra(t *testing.T) {
	rol := func(r sqlc.StaffRole) *auth.Sesion {
		return &auth.Sesion{Rol: sqlc.UserRoleStaff, RolStaff: &r}
	}
	f := Filtros{Proveedor: "x"}
	SoloQuienCompra(rol(sqlc.StaffRoleAdmin), &f)
	if f.Proveedor != "x" {
		t.Fatal("al admin le borró el proveedor")
	}
	SoloQuienCompra(rol(sqlc.StaffRoleVendedor), &f)
	if f.Proveedor != "" {
		t.Fatal("el vendedor filtra por proveedor")
	}
	f.Proveedor = "x"
	SoloQuienCompra(nil, &f)
	if f.Proveedor != "" {
		t.Fatal("sin sesión filtra por proveedor")
	}
}
