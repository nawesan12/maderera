package pedidos

import (
	"strings"
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
	// La zona tiene que ser una de las de envío.
	e.exec(t, `insert into shipping_zones (nombre, costo, a_cotizar) values ('Tandil', 0, true)`)

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

	// Cobrarlo con recibo: queda pagado por la suma de lo cobrado.
	total = e.texto(t, `select total::text from orders where id = $1`, retiro.ID)
	if c, b := pedir(t, ven, "POST", u+"pedidos/"+retiro.ID+"/cobro", map[string]any{"partes": `[{"medio":"transferencia","importe":"` + total + `"}]`}); c != 200 {
		t.Fatalf("cobrar: %d %s", c, b)
	}
	if m := e.texto(t, `select estado_pago::text from orders where id = $1`, retiro.ID); m != "pagado" {
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

// El día comprometido de entrega: se fija al pasar a pedido y se corrige
// desde la ficha. Es lo que dice si el pedido está atrasado.
func TestDiaDeEntregaDelPedido(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	dep, _ := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	u := e.srv.URL + "/api/v1/admin/"
	c, b := pedir(t, ven, "POST", u+"presupuestos", e.alta("Obra Gómez", 1, nil))
	if c != 200 {
		t.Fatalf("alta: %d %s", c, b)
	}
	c, b = pedir(t, ven, "POST", u+"presupuestos/"+leer[Resultado](t, b).ID+"/pedido", map[string]any{"entregarEl": "2026-12-03"})
	if c != 200 {
		t.Fatalf("convertir: %d %s", c, b)
	}
	id := leer[Resultado](t, b).ID
	if d := e.texto(t, `select to_char(entregar_el, 'YYYY-MM-DD') from orders where id = $1`, id); d != "2026-12-03" {
		t.Fatalf("al convertir: %s", d)
	}
	if c, _ := pedir(t, dep, "PUT", u+"pedidos/"+id+"/entrega", map[string]any{"entregarEl": "2026-12-05"}); c != 403 {
		t.Errorf("el depósito no compromete fechas: %d", c)
	}
	if c, b := pedir(t, ven, "PUT", u+"pedidos/"+id+"/entrega", map[string]any{"entregarEl": "2026-12-05"}); c != 200 {
		t.Fatalf("cambiar: %d %s", c, b)
	}
	_, b = pedir(t, ven, "GET", u+"pedidos/"+id, nil)
	if !strings.Contains(b, `"entregarEl":"2026-12-05"`) {
		t.Fatalf("la ficha: %s", b)
	}
}
