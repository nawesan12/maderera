package facturacion

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// La devolución de un pedido facturado desde el pedido (H279): la vendedora
// elige renglón y cantidad, sale la nota de crédito atada a la factura (misma
// letra y punto de venta, aunque la factura espere el CAE), lo traído vuelve
// al stock de la sucursal del pedido atado a la devolución, y baja lo que
// falta cobrar. Lo cobrado no se reintegra desde acá, y el depósito no lo
// hace.
func TestDevolucionDeUnPedidoFacturado(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	vendedora := e.staff(t, "v@mjbj.test", sqlc.StaffRoleVendedor)
	deposito := e.staff(t, "d@mjbj.test", sqlc.StaffRoleDeposito)
	var cat, prod, variante, sucursal, pedido, renglon string
	e.uno(t, `INSERT INTO branches (slug, name, sort_order) VALUES ('central', 'Central', 1) RETURNING id`, &sucursal)
	e.uno(t, `INSERT INTO categories (slug, name, description) VALUES ('pinturas', 'Pinturas', '') RETURNING id`, &cat)
	e.uno(t, `INSERT INTO products (slug, name, category_id, description, alicuota_iva) VALUES ('laca', 'Laca', $1, '', 21) RETURNING id`, &prod, cat)
	e.uno(t, `INSERT INTO product_variants (product_id, sku, label) VALUES ($1, 'LACA4', '4 l') RETURNING id`, &variante, prod)
	e.exec(t, `INSERT INTO inventory (variant_id, branch_id, qty) VALUES ($1, $2, 5)`, variante, sucursal)
	e.uno(t, `INSERT INTO orders (numero, contacto_nombre, origen, subtotal, total, medio_pago, branch_id, estado)
		VALUES ('PED-1066', 'Marta', 'presupuesto', 24200, 24200, 'efectivo', $1, 'entregado') RETURNING id`, &pedido, sucursal)
	e.uno(t, `INSERT INTO order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal)
		VALUES ($1, $2, 'Laca 4 l', 'unidad', 2, 12100, 24200) RETURNING id`, &renglon, pedido, variante)
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+pedido+"/facturar", nil); st != 200 {
		t.Fatalf("facturar: %d %s", st, b)
	}
	var factura, item, tipo string
	var pv int64
	e.uno(t, `SELECT id FROM invoices WHERE order_id = $1`, &factura, pedido)
	_ = e.pool.QueryRow(t.Context(), `SELECT tipo::text, punto_venta FROM invoices WHERE id = $1`, factura).Scan(&tipo, &pv)
	e.uno(t, `SELECT id FROM invoice_items WHERE invoice_id = $1`, &item, factura)
	u := e.srv.URL + "/api/v1/admin/facturacion/pedidos/" + pedido + "/devolucion"

	if st, _ := pedir(t, deposito, "GET", u, nil); st != 403 {
		t.Errorf("el depósito ve la devolución: %d", st)
	}
	st, b := pedir(t, vendedora, "GET", u, nil)
	if st != 200 {
		t.Fatalf("datos: %d %s", st, b)
	}
	d := leerJSON[DevolucionDesdeElPedido](t, b)
	if d.FacturaID != factura || d.Destino != "deuda" || d.Tope != 24200 || len(d.Renglones) != 1 || d.Renglones[0].Queda != 2 {
		t.Fatalf("datos: %+v", d)
	}
	renglones := []map[string]any{{"itemId": item, "cantidad": 1}}
	st, b = pedir(t, vendedora, "POST", u+"/calculo", map[string]any{"renglones": renglones})
	if st != 200 || !strings.Contains(string(b), `"importe":12100`) {
		t.Fatalf("cálculo: %d %s", st, b)
	}
	if st, b := pedir(t, vendedora, "POST", u, map[string]any{"clave": "k1", "motivo": "Sin abrir", "renglones": []map[string]any{{"itemId": item, "cantidad": 3}}}); st != 422 ||
		!strings.Contains(string(b), "hasta 2") {
		t.Fatalf("más de lo que queda: %d %s", st, b)
	}
	cuerpo := map[string]any{"clave": "k1", "motivo": "Sin abrir", "importe": 12100, "renglones": renglones}
	st, b = pedir(t, vendedora, "POST", u, cuerpo)
	if st != 200 {
		t.Fatalf("devolver: %d %s", st, b)
	}
	hecha := leerJSON[Devolucion](t, b)
	// El doble clic es la misma.
	if _, b2 := pedir(t, vendedora, "POST", u, cuerpo); !strings.Contains(string(b2), hecha.ID) || !strings.Contains(string(b2), `"repetida":true`) {
		t.Fatalf("repetida: %s", b2)
	}
	var notaTipo, origen, total string
	var notaPv int64
	_ = e.pool.QueryRow(t.Context(), `SELECT tipo::text, punto_venta, comprobante_origen_id::text, total::text FROM invoices WHERE id = $1`, hecha.NotaID).
		Scan(&notaTipo, &notaPv, &origen, &total)
	if notaTipo != "nota_credito_"+tipo[len(tipo)-1:] || notaPv != pv || origen != factura || total != "12100.00" {
		t.Fatalf("la nota: %s %d %s %s (factura %s %d)", notaTipo, notaPv, origen, total, tipo, pv)
	}
	var fisico, movimientos, destino string
	e.uno(t, `SELECT qty::text FROM inventory WHERE variant_id = $1 AND branch_id = $2`, &fisico, variante, sucursal)
	e.uno(t, `SELECT count(*)::text FROM inventory_movements WHERE documento_tipo = 'devolucion' AND documento_id = $1 AND type = 'devolucion'`, &movimientos, hecha.ID)
	e.uno(t, `SELECT destino FROM devoluciones WHERE id = $1 AND order_id = $2 AND invoice_id = $3`, &destino, hecha.ID, pedido, factura)
	if fisico != "6.000" && fisico != "6" || movimientos != "1" || destino != "deuda" {
		t.Fatalf("stock %s, movimientos %s, destino %s", fisico, movimientos, destino)
	}
	var historial int
	e.uno(t, `SELECT count(*)::int FROM order_status_history WHERE order_id = $1 AND nota LIKE 'Devolución · Nota de crédito%'`, &historial, pedido)
	if historial != 1 {
		t.Errorf("historial: %d", historial)
	}
	// Queda por cobrar la otra laca.
	_, b = pedir(t, vendedora, "GET", u, nil)
	if d := leerJSON[DevolucionDesdeElPedido](t, b); d.Tope != 12100 || d.Renglones[0].Queda != 1 {
		t.Fatalf("después: %+v", d)
	}

	// Cobrado entero, la plata no sale de acá.
	e.exec(t, `INSERT INTO payments (order_id, tipo, proveedor, medio, monto, estado) VALUES ($1, 'pedido', 'mostrador', 'transferencia', 12100, 'aprobado')`, pedido)
	if st, b := pedir(t, vendedora, "POST", u, map[string]any{"clave": "k2", "motivo": "Otra", "renglones": renglones}); st != 422 ||
		!strings.Contains(string(b), "ya está cobrado") {
		t.Fatalf("cobrado: %d %s", st, b)
	}
	// Mes simulado 2 (M2S2-022, M2S3-027): lo cobrado vuelve por donde
	// entró, elegido desde el pedido, con su nota y su número en el
	// historial (M3S2-049).
	_, b = pedir(t, vendedora, "GET", u, nil)
	if d := leerJSON[DevolucionDesdeElPedido](t, b); d.Afuera != 12100 || d.Caja != 0 {
		t.Fatalf("topes por medio: %+v", d)
	}
	if st, b := pedir(t, vendedora, "POST", u, map[string]any{"clave": "k3", "motivo": "Otra", "renglones": renglones, "destino": "caja"}); st != 422 {
		t.Fatalf("por la caja, sin efectivo: %d %s", st, b)
	}
	if st, b := pedir(t, vendedora, "POST", u, map[string]any{"clave": "k4", "motivo": "Otra", "renglones": renglones, "destino": "afuera"}); st != 200 {
		t.Fatalf("por afuera: %d %s", st, b)
	}
	e.uno(t, `SELECT count(*)::int FROM order_status_history WHERE order_id = $1 AND nota LIKE 'Devolución · Nota de crédito % · Vuelve por el banco'`, &historial, pedido)
	if historial != 1 {
		t.Errorf("historial con la nota y por dónde volvió: %d", historial)
	}
}

// A cuenta corriente, la nota va a la cuenta del cliente (baja la deuda o
// deja saldo a favor).
func TestDevolucionDeUnPedidoFacturadoACuenta(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	var cliente, pedido, item string
	e.uno(t, `INSERT INTO customers (nombre, condicion_iva) VALUES ('Constructora', 'consumidor_final') RETURNING id`, &cliente)
	e.uno(t, `INSERT INTO orders (numero, contacto_nombre, origen, subtotal, total, medio_pago, customer_id)
		VALUES ('PED-1070', 'Constructora', 'presupuesto', 10000, 10000, 'cuenta_corriente', $1) RETURNING id`, &pedido, cliente)
	e.exec(t, `INSERT INTO order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal)
		VALUES ($1, 'Flete', 'unidad', 1, 10000, 10000)`, pedido)
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+pedido+"/facturar", nil); st != 200 {
		t.Fatalf("facturar: %d %s", st, b)
	}
	e.uno(t, `SELECT ii.id FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.order_id = $1`, &item, pedido)
	u := e.srv.URL + "/api/v1/admin/facturacion/pedidos/" + pedido + "/devolucion"
	_, b := pedir(t, admin, "GET", u, nil)
	if d := leerJSON[DevolucionDesdeElPedido](t, b); d.Destino != "cuenta" || d.Tope != 10000 {
		t.Fatalf("datos: %+v", d)
	}
	if st, b := pedir(t, admin, "POST", u, map[string]any{"clave": "c1", "motivo": "No se hizo", "renglones": []map[string]any{{"itemId": item, "cantidad": 1}}}); st != 200 {
		t.Fatalf("devolver: %d %s", st, b)
	}
	var monto string
	e.uno(t, `SELECT monto::text FROM account_movements WHERE customer_id = $1 AND tipo = 'nota_credito'`, &monto, cliente)
	if monto != "-10000.00" {
		t.Fatalf("la cuenta: %s", monto)
	}
	// Sin factura viva, no hay nada que devolver desde acá.
	var otro string
	e.uno(t, `INSERT INTO orders (numero, contacto_nombre, subtotal, total) VALUES ('PED-1071', 'X', 0, 0) RETURNING id`, &otro)
	if st, _ := pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+otro+"/devolucion", nil); st != 404 {
		t.Errorf("sin factura: %d", st)
	}
}
