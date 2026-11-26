package entregas

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Lo que encontró el mes simulado en producción (26/11/2026) en los
// remitos: el envío en dos viajes, el corte sin terminar, la venta del
// mostrador que ya descontó el stock.

func (e *entorno) estadoYNota(t *testing.T, pedido string) (string, string) {
	t.Helper()
	var estado, nota string
	if err := e.pool.QueryRow(context.Background(), `
		select o.estado::text, coalesce(h.nota, '') from orders o left join order_status_history h on h.order_id = o.id
		where o.id = $1 order by h.created_at desc nulls last, h.id desc limit 1`, pedido).Scan(&estado, &nota); err != nil {
		t.Fatal(err)
	}
	return estado, nota
}

func (e *entorno) firmar(t *testing.T, remito string) {
	t.Helper()
	token := e.uno(t, `select firma_token from deliveries where numero = $1`, remito)
	if _, err := e.s.RegistrarFirma(context.Background(), FormFirma{Token: token, ReceptorNombre: "Quien Recibe", Firma: "data:image/png;base64,AAAA"}, nil); err != nil {
		t.Fatal(err)
	}
}

// El envío que sale en dos viajes: el primero deja el pedido en camino, la
// firma lo devuelve a listo con lo que falta, y el segundo viaje firmado lo
// entrega. Antes el pedido seguía «listo» con el total, como si no hubiera
// salido nada.
func TestEnvioEnDosViajes(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, r2 := e.pedido(t, "PED-2001", "listo", nil)
	e.exec(t, `update orders set tipo_entrega = 'envio' where id = $1`, pedido)
	e.exec(t, `insert into order_status_history (order_id, estado) values ($1, 'listo')`, pedido)
	u := e.srv.URL + "/api/v1/admin/remitos"

	c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "envio", "cantidades": cantidades(r1, "10")})
	if c != 200 || !strings.Contains(b, "El resto queda por llevar.") {
		t.Fatalf("primer viaje: %d %s", c, b)
	}
	if estado, nota := e.estadoYNota(t, pedido); estado != "en-camino" || nota != "Remito REM-0001: salió en camino una parte" {
		t.Fatalf("en el camión: %q %q", estado, nota)
	}
	e.firmar(t, "REM-0001")
	if estado, nota := e.estadoYNota(t, pedido); estado != "listo" || nota != "Remito REM-0001 firmado: falta llevar el resto" {
		t.Fatalf("vuelto el camión: %q %q", estado, nota)
	}

	c, b = pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "envio", "cantidades": cantidades(r2, "4")})
	if c != 200 || !strings.Contains(b, "El pedido sale en camino.") {
		t.Fatalf("segundo viaje: %d %s", c, b)
	}
	e.firmar(t, "REM-0002")
	if estado, nota := e.estadoYNota(t, pedido); estado != "entregado" || !strings.HasSuffix(nota, "Remito REM-0002 firmado") {
		t.Fatalf("entregado: %q %q", estado, nota)
	}
}

// Anular el remito del camión devuelve el pedido a donde estaba.
func TestAnularElRemitoDelCamion(t *testing.T) {
	e := armar(t)
	ven, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, r2 := e.pedido(t, "PED-2002", "listo", nil)
	e.exec(t, `update orders set tipo_entrega = 'envio' where id = $1`, pedido)
	e.exec(t, `insert into order_status_history (order_id, estado) values ($1, 'listo')`, pedido)
	c, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/remitos", map[string]any{"orderId": pedido, "tipo": "envio", "cantidades": cantidades(r1, "10", r2, "4")})
	if c != 200 {
		t.Fatalf("%d %s", c, b)
	}
	if err := e.s.AnularEntrega(context.Background(), ses, e.uno(t, `select id::text from deliveries where numero = 'REM-0001'`)); err != nil {
		t.Fatal(err)
	}
	if estado, nota := e.estadoYNota(t, pedido); estado != "listo" || !strings.Contains(nota, "anulado") {
		t.Fatalf("anulado: %q %q", estado, nota)
	}
}

// El corte sin terminar no deja completar el pedido; terminado, sale con
// él y queda retirado.
func TestElCorteSaleConElPedido(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, r2 := e.pedido(t, "PED-2003", "listo", nil)
	corte := e.uno(t, `insert into cutting_orders (numero, order_id, contacto_nombre, material_descripcion, estado)
		values ('CRT-3', $1, 'Marta', 'Melamina 18', 'en-cola') returning id::text`, pedido)
	u := e.srv.URL + "/api/v1/admin/remitos"
	c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "20111222",
		"cantidades": cantidades(r1, "10", r2, "4")})
	if c != 422 || !strings.Contains(b, "El corte CRT-3 todavía no salió de la máquina") {
		t.Fatalf("con el corte en cola: %d %s", c, b)
	}
	// Lo que no completa el pedido sale igual.
	if c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "20111222",
		"cantidades": cantidades(r2, "4")}); c != 200 {
		t.Fatalf("parcial: %d %s", c, b)
	}
	e.exec(t, `update cutting_orders set estado = 'terminado' where id = $1`, corte)
	if c, b := pedir(t, ven, "POST", u, map[string]any{"orderId": pedido, "tipo": "retiro", "receptorDocumento": "20111222",
		"cantidades": cantidades(r1, "10")}); c != 200 {
		t.Fatalf("con el corte terminado: %d %s", c, b)
	}
	if estado := e.uno(t, `select estado::text from cutting_orders where id = $1`, corte); estado != "retirado" {
		t.Errorf("el corte quedó %q", estado)
	}
	if estado, _ := e.estadoYNota(t, pedido); estado != "entregado" {
		t.Errorf("el pedido quedó %q", estado)
	}
}

// La venta del mostrador que ya descontó el stock (la que lleva un corte y
// queda en curso): el remito no vuelve a sacarlo.
func TestElRemitoDeUnaVentaQueYaDescontoNoSacaOtraVez(t *testing.T) {
	e := armar(t)
	ven, _ := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido, r1, r2 := e.pedido(t, "PED-2004", "listo", nil)
	e.exec(t, `update stock_reservations set estado = 'liberada' where order_id = $1`, pedido)
	e.exec(t, `update inventory set reservado = 0, qty = qty - 10 where variant_id = $1`, e.variante)
	e.exec(t, `insert into inventory_movements (variant_id, branch_id, type, qty, note) values ($1, $2, 'venta', -10, 'Mostrador PED-2004')`, e.variante, e.sucursal)
	antes := e.uno(t, `select qty::text from inventory where variant_id = $1`, e.variante)
	if c, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/remitos", map[string]any{"orderId": pedido, "tipo": "retiro",
		"receptorDocumento": "20111222", "cantidades": cantidades(r1, "10", r2, "4")}); c != 200 {
		t.Fatalf("%d %s", c, b)
	}
	if despues := e.uno(t, `select qty::text from inventory where variant_id = $1`, e.variante); despues != antes {
		t.Errorf("el stock bajó otra vez: %s → %s", antes, despues)
	}
}
