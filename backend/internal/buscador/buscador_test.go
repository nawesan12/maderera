package buscador

import (
	"context"
	"testing"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

func rol(r sqlc.StaffRole) *sqlc.StaffRole { return &r }

func TestBuscar(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `insert into customers (nombre, cuit) values ('Carpintería Ñandú', '30589445259')`)
	_, _ = pool.Exec(ctx, `insert into suppliers (nombre) values ('Tableros Ñandú')`)
	_, _ = pool.Exec(ctx, `insert into orders (numero, contacto_nombre, created_at) values ('PED-0042', 'Juan Ñandú', '2026-11-11 01:30:00+00')`)

	r, err := Buscar(ctx, pool, rol(sqlc.StaffRoleAdmin), "nandu")
	if err != nil {
		t.Fatal(err)
	}
	tipos := map[string]string{}
	for _, x := range r {
		tipos[x.Tipo] = x.Titulo + " | " + x.Detalle
	}
	if tipos["Cliente"] != "Carpintería Ñandú | 30589445259" || tipos["Proveedor"] == "" || tipos["Pedido"] != "PED-0042 · Juan Ñandú | pendiente · 10/11/2026" {
		t.Errorf("admin: %v", tipos)
	}
	// Una palabra corta no busca nada.
	if r, _ := Buscar(ctx, pool, rol(sqlc.StaffRoleAdmin), "n"); len(r) != 0 {
		t.Errorf("una letra: %v", r)
	}
	// El aserradero no entra a clientes ni a proveedores: no los ve.
	r, _ = Buscar(ctx, pool, rol(sqlc.StaffRoleAserradero), "nandu")
	for _, x := range r {
		if x.Tipo == "Cliente" || x.Tipo == "Proveedor" {
			t.Errorf("el aserradero vio %s", x.Tipo)
		}
	}
}
