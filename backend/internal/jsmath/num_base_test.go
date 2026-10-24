package jsmath

import (
	"context"
	"math"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
)

// Contra un Postgres de verdad: MJBJ_PRUEBA_BASE=postgres://… go test.
// Sin la variable, se saltea (no hay base en todos lados).
func TestNumContraPostgres(t *testing.T) {
	url := os.Getenv("MJBJ_PRUEBA_BASE")
	if url == "" {
		t.Skip("sin MJBJ_PRUEBA_BASE")
	}
	ctx := context.Background()
	c, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(ctx)

	var a, b, d Num
	var nulo *Num
	err = c.QueryRow(ctx, `select '123.45'::numeric(12,2), '1.0050'::numeric(14,4), '-0.10'::numeric(12,2), null::numeric`).Scan(&a, &b, &d, &nulo)
	if err != nil {
		t.Fatal(err)
	}
	if a != 123.45 || b != 1.005 || d != -0.1 || nulo != nil {
		t.Fatalf("leídos: %v %v %v %v", a, b, d, nulo)
	}
	// Ida y vuelta: lo que se escribe es lo que se lee.
	for _, x := range []float64{0.1 + 0.2, 1234.5678, 99.99, 1e-7, 123456789012.34} {
		var y Num
		if err := c.QueryRow(ctx, `select $1::numeric`, Num(x)).Scan(&y); err != nil {
			t.Fatal(err)
		}
		if math.Float64bits(float64(y)) != math.Float64bits(x) {
			t.Errorf("%v volvió como %v", x, y)
		}
	}
	// Redondeado por la columna, como pasa al guardar un importe.
	var z Num
	if err := c.QueryRow(ctx, `select $1::numeric(12,2)`, Num(10.005)).Scan(&z); err != nil {
		t.Fatal(err)
	}
	if z != 10.01 {
		t.Errorf("numeric(12,2) de 10.005 dio %v (Postgres redondea la mitad hacia arriba: 10.01)", z)
	}
}
