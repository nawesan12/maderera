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

// La venta del mostrador queda «entregado» con el retiro para firmar: el
// portal la listaba «Entregado», «Qué fue pasando» decía «Entregado» y el
// detalle «Listo» (mes 23, M2S1-071). Hasta la firma es «por-firmar» en
// todos lados: «Listo para retirar» se lo decía al que ya se la había
// llevado (PED-1150).
func TestElRetiroSinFirmarEsListo(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	web, cliente := e.web(t, "roberto@prueba.test")
	var pedido string
	if err := e.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, customer_id, total, subtotal, medio_pago, origen,
		estado, estado_pago, public_token) values ('PED-1139', 'Roberto', $1, 1000, 1000, 'cuenta_corriente', 'mostrador', 'entregado', 'pagado', gen_random_uuid())
		returning id`, cliente).Scan(&pedido); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into order_status_history (order_id, estado) values ($1, 'entregado')`, pedido); err != nil {
		t.Fatal(err)
	}
	var remito string
	if err := e.pool.QueryRow(ctx, `insert into deliveries (numero, order_id, tipo, estado, firma_token) values ('REM-0022', $1, 'retiro', 'preparada', 'tok-mes23')
		returning id`, pedido).Scan(&remito); err != nil {
		t.Fatal(err)
	}
	estado := func() (string, string, int) {
		t.Helper()
		_, lista := pedir(t, web, "GET", e.srv.URL+"/api/v1/cuenta/pedidos", nil)
		var ps []Pedido
		if err := json.Unmarshal([]byte(lista), &ps); err != nil || len(ps) != 1 {
			t.Fatalf("lista: %s", lista)
		}
		_, det := pedir(t, web, "GET", e.srv.URL+"/api/v1/cuenta/pedidos/PED-1139", nil)
		var p PedidoPropio
		if err := json.Unmarshal([]byte(det), &p); err != nil {
			t.Fatalf("detalle: %s", det)
		}
		entregados := 0
		for _, h := range p.Historial {
			if h.Estado == "entregado" {
				entregados++
			}
		}
		return ps[0].Estado, p.Estado, entregados
	}
	if l, d, h := estado(); l != "por-firmar" || d != "por-firmar" || h != 0 {
		t.Errorf("sin firmar: lista %s, detalle %s, %d «entregado» en el historial", l, d, h)
	}
	if _, err := e.pool.Exec(ctx, `update deliveries set estado = 'entregada' where id = $1`, remito); err != nil {
		t.Fatal(err)
	}
	if l, d, h := estado(); l != "entregado" || d != "entregado" || h != 1 {
		t.Errorf("firmado: lista %s, detalle %s, %d «entregado» en el historial", l, d, h)
	}
}
