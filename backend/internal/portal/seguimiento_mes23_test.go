package portal

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

// El seguimiento público dice en qué está el pedido (mes simulado,
// M2S1-103, M2S2-110, M2S3-010, M3S4-043, M2S2-060): cuándo se entregó, si
// falta cobrar algo, el descuento que se repartió y si el cliente ya tiene
// cuenta.
func TestSeguimientoDiceEnQueEsta(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	_, cliente := e.web(t, "martina@prueba.test")
	var token, pedido string
	if err := e.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, customer_id, total, subtotal, descuento, medio_pago,
		estado, estado_pago, public_token) values ('PED-1315', 'Martina', $1, 23085, 25650, 2565, 'transferencia', 'entregado', 'pagado', gen_random_uuid())
		returning public_token::text, id`, cliente).Scan(&token, &pedido); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into order_status_history (order_id, estado, created_at) values ($1, 'entregado', '2026-11-27T15:00:00Z')`, pedido); err != nil {
		t.Fatal(err)
	}
	var sinCuenta string
	if err := e.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, total, subtotal, medio_pago, estado, estado_pago, public_token)
		values ('PED-1316', 'Ana', 1000, 1000, 'transferencia', 'pendiente', 'pendiente', gen_random_uuid()) returning public_token::text`).Scan(&sinCuenta); err != nil {
		t.Fatal(err)
	}
	leer := func(numero, tok string) Seguimiento {
		t.Helper()
		codigo, cuerpo := pedir(t, http.DefaultClient, "GET", e.srv.URL+"/api/v1/pedidos/"+numero+"/seguimiento?t="+tok, nil)
		if codigo != 200 {
			t.Fatalf("%s: %d %s", numero, codigo, cuerpo)
		}
		var s Seguimiento
		if err := json.Unmarshal([]byte(cuerpo), &s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	s := leer("PED-1315", token)
	if s.EntregadoAt == nil || s.EntregadoAt.UTC().Format("2006-01-02T15") != "2026-11-27T15" || s.SinCobrar != 0 || s.Descuento != 2565 || !s.ConCuenta {
		t.Errorf("entregado y cobrado: %+v", s)
	}
	s = leer("PED-1316", sinCuenta)
	if s.EntregadoAt != nil || s.SinCobrar != 1000 || s.ConCuenta {
		t.Errorf("sin cobrar: %+v", s)
	}
}
