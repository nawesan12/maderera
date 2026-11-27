package clientes

import (
	"context"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/pruebas"
)

// M3S1-025: unida la cuenta web a la ficha del panel, la ficha del sitio
// queda apagada y no ofrece vincularla de vuelta.
func TestLaFichaApagadaNoOfreceVincular(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	s := Nuevo(pool, silencio)
	ses := &auth.Sesion{UserID: "nadie", Nombre: "Vendedora"}
	if _, err := pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ('web', 'Web', 'sim.aberturas@ejemplo.test', true, now(), now())`); err != nil {
		t.Fatal(err)
	}
	var panel, web string
	_ = pool.QueryRow(ctx, `insert into customers (nombre, email) values ('Sim Aberturas del Sur SRL', 'sim.aberturas@ejemplo.test') returning id`).Scan(&panel)
	_ = pool.QueryRow(ctx, `insert into customers (nombre, email, user_id) values ('Sim Aberturas del Sur', 'sim.aberturas@ejemplo.test', 'web') returning id`).Scan(&web)
	f, err := s.Obtener(ctx, panel)
	if err != nil || f.CuentaWebSinVincular == nil || f.CuentaWebSinVincular.ID != web {
		t.Fatalf("antes de unir, la del panel ofrece vincular: %+v %v", f, err)
	}
	if err := s.VincularCuentaWeb(ctx, ses, panel, web); err != nil {
		t.Fatal(err)
	}
	f, err = s.Obtener(ctx, web)
	if err != nil || f.CuentaWebSinVincular != nil {
		t.Fatalf("la ficha apagada ofrece vincular: %+v %v", f.CuentaWebSinVincular, err)
	}
}
