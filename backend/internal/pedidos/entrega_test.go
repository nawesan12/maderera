package pedidos

import (
	"testing"

	"mjbj/internal/sqlc"
)

// El presupuesto que pasa a pedido con envío y a cuenta corriente: antes el
// pedido quedaba como retiro, sin dirección ni medio, y la deuda no se
// asentaba en ningún lado.
func TestPresupuestoAPedidoConEnvioYACuenta(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	_, cliente := e.web(t, "cliente@prueba.test")
	u := e.srv.URL + "/api/v1/admin/"

	nuevo := func() string {
		c, b := pedir(t, ven, "POST", u+"presupuestos", e.alta("Obra Pérez", 1, map[string]any{"customerId": cliente}))
		if c != 200 {
			t.Fatalf("alta: %d %s", c, b)
		}
		return leer[Resultado](t, b).ID
	}

	// Sin dirección no sale con envío.
	p := nuevo()
	if c, b := pedir(t, ven, "POST", u+"presupuestos/"+p+"/pedido", map[string]any{"tipoEntrega": "envio"}); c != 422 {
		t.Fatalf("envío sin dirección: %d %s", c, b)
	}

	// Sin límite de crédito, a cuenta no entra.
	cuerpo := map[string]any{"tipoEntrega": "envio", "direccion": "Av. Colón 1234", "zona": "Tandil", "costoEnvio": 18000.0, "medioPago": "cuenta_corriente"}
	if c, b := pedir(t, ven, "POST", u+"presupuestos/"+p+"/pedido", cuerpo); c != 422 {
		t.Fatalf("a cuenta sin límite: %d %s", c, b)
	}

	e.exec(t, `update customers set limite_credito = 500000 where id = $1`, cliente)
	c, b := pedir(t, ven, "POST", u+"presupuestos/"+p+"/pedido", cuerpo)
	if c != 200 {
		t.Fatalf("convertir: %d %s", c, b)
	}
	pedido := leer[Resultado](t, b)

	var tipo, direccion, zona, medio, costo, total string
	if err := e.pool.QueryRow(t.Context(), `
		SELECT tipo_entrega::text, direccion_entrega, zona_envio, medio_pago::text, costo_envio::text, total::text
		FROM orders WHERE id = $1`, pedido.ID).Scan(&tipo, &direccion, &zona, &medio, &costo, &total); err != nil {
		t.Fatal(err)
	}
	// 84500 de la placa + 12000,50 del flete + 18000 del envío.
	if tipo != "envio" || direccion != "Av. Colón 1234" || zona != "Tandil" || medio != "cuenta_corriente" || costo != "18000.00" || total != "114500.50" {
		t.Fatalf("pedido: %s %s %s %s %s %s", tipo, direccion, zona, medio, costo, total)
	}
	if d := e.numero(t, `select coalesce(sum(monto),0) from account_movements where customer_id = $1 and referencia = $2 and tipo = 'compra'`, cliente, pedido.Numero); d != 114500.5 {
		t.Fatalf("deuda asentada: %v", d)
	}

	// Cancelarlo devuelve la deuda.
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+pedido.ID+"/cancelar", map[string]any{"motivo": "Se arrepintió"}); c != 200 {
		t.Fatalf("cancelar: %d %s", c, b)
	}
	if d := e.numero(t, `select coalesce(sum(monto),0) from account_movements where customer_id = $1 and referencia = $2`, cliente, pedido.Numero); d != 0 {
		t.Fatalf("deuda después de cancelar: %v", d)
	}

	// Sin cuerpo sigue siendo retiro, como antes.
	c, b = pedir(t, ven, "POST", u+"presupuestos/"+nuevo()+"/pedido", nil)
	if c != 200 {
		t.Fatalf("convertir sin cuerpo: %d %s", c, b)
	}
	retiro := leer[Resultado](t, b)
	if tipo := e.texto(t, `select tipo_entrega::text from orders where id = $1`, retiro.ID); tipo != "retiro" {
		t.Fatalf("sin cuerpo: %s", tipo)
	}

	// Cobrar diciendo con qué: queda el medio.
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+retiro.ID+"/cobrado", map[string]any{"medioPago": "cuenta_corriente"}); c != 422 {
		t.Fatalf("cobrar a cuenta: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+retiro.ID+"/cobrado", map[string]any{"medioPago": "transferencia"}); c != 200 {
		t.Fatalf("cobrar: %d %s", c, b)
	}
	if m := e.texto(t, `select medio_pago::text || '/' || estado_pago::text from orders where id = $1`, retiro.ID); m != "transferencia/pagado" {
		t.Fatalf("cobrado: %s", m)
	}
}

func (e *entorno) texto(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var v string
	if err := e.pool.QueryRow(t.Context(), sql, args...).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}
