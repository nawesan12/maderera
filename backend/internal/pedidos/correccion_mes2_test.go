package pedidos

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Mes simulado 2 (M2S1-100, M2S2-021): la corrección suma un renglón (con
// su reserva) y cambia el retiro por un envío con el flete de la zona; un
// pedido ya entregado no se corrige.
func TestCorregirSumaRenglonesYCambiaLaEntrega(t *testing.T) {
	e := armar(t)
	ven, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.exec(t, `insert into shipping_zones (nombre, costo, a_cotizar) values ('Batán', 9000, false)`)
	pedido := e.pedido(t, ses, 1)
	e.exec(t, `update orders set medio_pago = 'efectivo' where id = $1`, pedido)
	total := e.numero(t, `select total from orders where id = $1`, pedido)
	reservado := e.reservado(t, e.placa)
	u := e.srv.URL + "/api/v1/admin/pedidos/" + pedido + "/correccion"
	cuerpo := map[string]any{"renglones": []any{}, "motivo": "Se olvidó una placa y es con envío",
		"nuevos":  []any{map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "unidad": "placa", "cantidad": 2, "precioUnitario": 84500}},
		"entrega": "envio", "direccion": "Av. Sim 123", "zona": "Batán"}
	if c, b := pedir(t, ven, "POST", u, cuerpo); c != 200 {
		t.Fatalf("corregir: %d %s", c, b)
	}
	if nuevo := e.numero(t, `select total from orders where id = $1`, pedido); nuevo != total+2*84500+9000 {
		t.Errorf("total: %v, antes %v", nuevo, total)
	}
	if tipo := e.texto(t, `select tipo_entrega::text || ' ' || direccion_entrega || ' ' || zona_envio from orders where id = $1`, pedido); tipo != "envio Av. Sim 123 Batán" {
		t.Errorf("entrega: %q", tipo)
	}
	if d := e.reservado(t, e.placa) - reservado; d != 2 {
		t.Errorf("reserva del renglón nuevo: %v", d)
	}
	if n := e.numero(t, `select count(*) from order_status_history where order_id = $1 and nota like 'Corregido: %Suma 2 Fenólico 18 mm%'`, pedido); n != 1 {
		t.Errorf("historial: %v", n)
	}
	// Entregado, no se corrige.
	e.exec(t, `update orders set estado = 'entregado' where id = $1`, pedido)
	if c, b := pedir(t, ven, "POST", u, map[string]any{"renglones": []any{}, "costoEnvio": 0, "motivo": "otra"}); c != 422 || !strings.Contains(b, "Ya se entregó") {
		t.Errorf("entregado: %d %s", c, b)
	}
}

// Mes 23 (PED-1132): sumar un renglón recalcula el 10 % por transferencia
// sobre lo que se vende ahora; un descuento puesto a mano, con otro motivo,
// queda como estaba.
func TestCorregirRecalculaElDescuentoPorFormaDePago(t *testing.T) {
	e := armar(t)
	ven, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.exec(t, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta, activo) values ('transferencia', 0, 10, '10% por transferencia', true)`)
	transferencia := "transferencia"
	r, err := e.s.ConvertirConEntrega(t.Context(), ses, e.presupuesto(t, ses, 2), Entrega{MedioPago: &transferencia})
	if err != nil {
		t.Fatal(err)
	}
	if d := e.numero(t, `select descuento from orders where id = $1`, r.ID); d != 16900 {
		t.Fatalf("descuento al pasar a pedido: %v", d)
	}
	u := e.srv.URL + "/api/v1/admin/pedidos/" + r.ID + "/correccion"
	cuerpo := map[string]any{"renglones": []any{}, "motivo": "Suma una placa",
		"nuevos": []any{map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "unidad": "placa", "cantidad": 1, "precioUnitario": 84500}}}
	if c, b := pedir(t, ven, "POST", u, cuerpo); c != 200 {
		t.Fatalf("corregir: %d %s", c, b)
	}
	// 3 × 84.500 = 253.500: el 10 % es 25.350.
	if d := e.numero(t, `select descuento from orders where id = $1`, r.ID); d != 25350 {
		t.Errorf("descuento después: %v", d)
	}
	if v := e.numero(t, `select (subtotal + costo_envio - descuento - total) from orders where id = $1`, r.ID); v != 0 {
		t.Errorf("el total no cierra: %v", v)
	}
	if m := e.texto(t, `select descuento_motivo from orders where id = $1`, r.ID); m != "10% por transferencia" {
		t.Errorf("motivo: %q", m)
	}
	// A mano, con su motivo: no se toca.
	e.exec(t, `update orders set descuento = 1000, descuento_motivo = 'Cliente de siempre', total = subtotal + costo_envio - 1000 where id = $1`, r.ID)
	if c, b := pedir(t, ven, "POST", u, cuerpo); c != 200 {
		t.Fatalf("corregir 2: %d %s", c, b)
	}
	if d := e.numero(t, `select descuento from orders where id = $1`, r.ID); d != 1000 {
		t.Errorf("el de a mano: %v", d)
	}
}
