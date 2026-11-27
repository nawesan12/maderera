package portal

import (
	"context"
	"testing"

	"mjbj/internal/pruebas"
)

// M3S1-017: con la cuenta bloqueada, el resumen del portal lo dice y no
// ofrece el disponible.
func TestResumenConLaCuentaBloqueada(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `insert into customers (nombre, limite_credito, cuenta_bloqueada) values ('Sim Aberturas del Sur SRL', 600000, true) returning id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	r, err := Nuevo(pool).ResumenDe(ctx, &Cliente{ID: id, LimiteCredito: 600000})
	if err != nil || !r.CuentaPausada {
		t.Fatalf("resumen: %+v %v", r, err)
	}
}
