package pedidos

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// La devolución de un pedido sin factura (mes simulado: Marta devolvió una
// laca de un pedido entregado y sin cobrar; el stock volvió con un ajuste
// suelto y el pedido seguía cobrando lo devuelto). Vuelve al stock atado al
// pedido, baja lo que falta cobrar, queda en el historial, y una clave
// repetida no devuelve dos veces.
func TestDevolucionDeUnPedidoSinFactura(t *testing.T) {
	e := armar(t)
	ven, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	dep, _ := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	pedido := e.pedido(t, ses, 2)
	e.exec(t, `update orders set estado = 'listo', medio_pago = 'efectivo' where id = $1`, pedido)
	u := e.srv.URL + "/api/v1/admin/pedidos/" + pedido
	if c, b := pedir(t, ven, "POST", u+"/avanzar?desde=listo", map[string]any{"receptorDocumento": "20111222"}); c != 200 {
		t.Fatalf("entregar: %d %s", c, b)
	}
	placa := e.texto(t, `select id::text from order_items where order_id = $1 and variant_id is not null`, pedido)
	antes := e.numero(t, `select qty from inventory where variant_id = $1`, e.placa)
	falta := e.numero(t, `select total from orders where id = $1`, pedido)

	cuerpo := map[string]any{"renglones": []any{map[string]any{"orderItemId": placa, "cantidad": 1}}, "motivo": "Sin abrir", "clave": "dev-1"}
	if c, b := pedir(t, dep, "POST", u+"/devolucion", cuerpo); c != 403 {
		t.Fatalf("el depósito devolvió plata: %d %s", c, b)
	}
	for i := 0; i < 2; i++ {
		if c, b := pedir(t, ven, "POST", u+"/devolucion", cuerpo); c != 200 {
			t.Fatalf("devolver (%d): %d %s", i, c, b)
		}
	}
	if d := e.numero(t, `select qty from inventory where variant_id = $1`, e.placa) - antes; d != 1 {
		t.Errorf("volvió al stock: %v", d)
	}
	if n := e.numero(t, `select count(*) from inventory_movements where documento_tipo = 'devolucion' and note = 'Devolución PED-1000'`); n != 1 {
		t.Errorf("movimientos atados a la devolución: %v", n)
	}
	importe := e.numero(t, `select importe from devoluciones where order_id = $1`, pedido)
	f, err := e.s.Pedido(t.Context(), pedido, false)
	if err != nil {
		t.Fatal(err)
	}
	if importe <= 0 || f.SinCobrar == nil || *f.SinCobrar != falta-importe {
		t.Errorf("lo que falta cobrar: %v (total %v, devuelto %v)", f.SinCobrar, falta, importe)
	}
	if n := e.numero(t, `select count(*) from order_status_history where order_id = $1 and nota like 'Devolución · 1 Fenólico%'`, pedido); n != 1 {
		t.Errorf("historial: %v", n)
	}
	// La bitácora dice por dónde volvió (mes 23: «por $ 22.221» a secas).
	if n := e.numero(t, `select count(*) from audit_log where descripcion like 'Devolución sin factura del pedido PED-1000 por %, descontada de lo que falta cobrar'`); n != 1 {
		t.Errorf("bitácora con el medio: %v", n)
	}
	// No se trae más de lo que se llevó.
	cuerpo = map[string]any{"renglones": []any{map[string]any{"orderItemId": placa, "cantidad": 5}}, "motivo": "x", "clave": "dev-2"}
	if c, b := pedir(t, ven, "POST", u+"/devolucion", cuerpo); c != 422 || !strings.Contains(b, "se puede devolver hasta 1") {
		t.Errorf("de más: %d %s", c, b)
	}
}

// Lo del acopio no vuelve al físico: baja la reserva.
func TestDevolucionDelAcopioBajaLaReserva(t *testing.T) {
	e := armar(t)
	ven, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido := e.pedido(t, ses, 3)
	e.exec(t, `update orders set medio_pago = 'transferencia' where id = $1`, pedido)
	placa := e.texto(t, `select id::text from order_items where order_id = $1 and variant_id is not null`, pedido)
	antes := e.reservado(t, e.placa)
	c, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/pedidos/"+pedido+"/devolucion",
		map[string]any{"renglones": []any{map[string]any{"orderItemId": placa, "cantidad": 2}}, "motivo": "Se pasó", "clave": "dev-a"})
	if c != 200 {
		t.Fatalf("%d %s", c, b)
	}
	if d := antes - e.reservado(t, e.placa); d != 2 {
		t.Errorf("bajó la reserva: %v", d)
	}
}

// Un pedido sin factura ni cobro se corrige: el flete que faltó, una
// cantidad de menos (la reserva baja). Con un cobro, no.
func TestCorregirUnPedidoMalCargado(t *testing.T) {
	e := armar(t)
	ven, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	pedido := e.pedido(t, ses, 3)
	e.exec(t, `update orders set tipo_entrega = 'envio', medio_pago = 'efectivo' where id = $1`, pedido)
	placa := e.texto(t, `select id::text from order_items where order_id = $1 and variant_id is not null`, pedido)
	precio := e.numero(t, `select precio_unitario from order_items where id = $1`, placa)
	total := e.numero(t, `select total from orders where id = $1`, pedido)
	reservado := e.reservado(t, e.placa)
	u := e.srv.URL + "/api/v1/admin/pedidos/" + pedido + "/correccion"
	cuerpo := map[string]any{"renglones": []any{map[string]any{"orderItemId": placa, "cantidad": 2, "precioUnitario": precio}},
		"costoEnvio": 18000, "motivo": "Faltó el flete"}
	if c, b := pedir(t, ven, "POST", u, cuerpo); c != 200 || !strings.Contains(b, "PED-1000 corregido.") {
		t.Fatalf("corregir: %d %s", c, b)
	}
	if nuevo := e.numero(t, `select total from orders where id = $1`, pedido); nuevo != total-precio+18000 {
		t.Errorf("total: %v, antes %v", nuevo, total)
	}
	if d := reservado - e.reservado(t, e.placa); d != 1 {
		t.Errorf("la reserva bajó %v", d)
	}
	if n := e.numero(t, `select count(*) from order_status_history where order_id = $1 and nota like 'Corregido: %Flete: % · Faltó el flete'`, pedido); n != 1 {
		t.Errorf("historial: %v", n)
	}
	// Con un cobro ya no se corrige.
	e.exec(t, `insert into receipts (numero, recibido_de, total, origen, order_id) values ('REC-1', 'X', 1000, 'panel', $1)`, pedido)
	if c, b := pedir(t, ven, "POST", u, map[string]any{"renglones": []any{}, "costoEnvio": 0, "motivo": "otra"}); c != 422 || !strings.Contains(b, "Ya tiene un cobro") {
		t.Errorf("con cobro: %d %s", c, b)
	}
}

// Mes 23 (PED-1123): con el 10 % por transferencia, la devolución sin
// factura devuelve lo cobrado y no la lista; de a partes, la suma da justo
// lo que se cobró, y el diálogo recibe el mismo neto.
func TestLaDevolucionSinFacturaVuelveNetaDelDescuento(t *testing.T) {
	e := armar(t)
	ven, ses := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.exec(t, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta, activo) values ('transferencia', 0, 10, '10% por transferencia', true)`)
	transferencia := "transferencia"
	r, err := e.s.ConvertirConEntrega(t.Context(), ses, e.presupuesto(t, ses, 3), Entrega{MedioPago: &transferencia})
	if err != nil {
		t.Fatal(err)
	}
	pedido := r.ID
	placa := e.texto(t, `select id::text from order_items where order_id = $1 and variant_id is not null`, pedido)
	// 3 × 84.500 = 253.500, menos 25.350: se cobra 228.150 por las tres.
	datos, err := e.s.DatosDeDevolucion(t.Context(), pedido)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range datos.Renglones {
		if d.OrderItemID == placa && d.Neto != 228150 {
			t.Errorf("neto en el diálogo: %v", d.Neto)
		}
	}
	u := e.srv.URL + "/api/v1/admin/pedidos/" + pedido + "/devolucion"
	for i, cant := range []float64{1, 2} {
		cuerpo := map[string]any{"renglones": []any{map[string]any{"orderItemId": placa, "cantidad": cant}}, "motivo": "Sin abrir", "clave": "neto-" + string(rune('a'+i))}
		if c, b := pedir(t, ven, "POST", u, cuerpo); c != 200 {
			t.Fatalf("devolver %v: %d %s", cant, c, b)
		}
	}
	if v := e.texto(t, `select string_agg(importe::text, ' ' order by created_at) from devoluciones where order_id = $1`, pedido); v != "76050.00 152100.00" {
		t.Errorf("importes: %q", v)
	}
}
