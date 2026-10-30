package facturacion

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Lo que encontró la auditoría de facturación e IVA: cada prueba falla sin su
// arreglo.

// **Lo exento contado dos veces.** Un renglón al 0 % iba al neto y al exento:
// a ARCA le llegaba ImpNeto (con lo exento adentro) + ImpOpEx y el total no
// cerraba (10048), y la percepción de IIBB se calculaba sobre lo exento.
func TestExentoNoVaAlNeto(t *testing.T) {
	e := armar(t, true)
	e.exec(t, `UPDATE configuracion_fiscal SET percibe_iibb = true, alicuota_percepcion_iibb = 3`)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	campos := map[string]string{"receptorNombre": "Gómez SRL", "receptorCuit": "30-71234567-1", "receptorCondicionIva": "responsable_inscripto"}
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(campos,
		[4]string{"Fenólico", "1", "12100", "21"}, [4]string{"Libro técnico", "1", "1000", "0"}))
	if st != 200 {
		t.Fatalf("emitir: %d %s", st, b)
	}
	id := leerJSON[map[string]string](t, b)["invoiceId"]
	var neto, exento, tributos, total string
	if err := e.pool.QueryRow(context.Background(), `SELECT neto::text, exento::text, tributos::text, total::text FROM invoices WHERE id = $1`, id).
		Scan(&neto, &exento, &tributos, &total); err != nil {
		t.Fatal(err)
	}
	// Percepción: 3 % de 10.000 (el neto gravado), no de 11.000.
	if neto != "10000.00" || exento != "1000.00" || tributos != "300.00" || total != "13400.00" {
		t.Fatalf("importes: neto %s, exento %s, tributos %s, total %s", neto, exento, tributos, total)
	}
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/autorizar", nil)
	if st != 200 || leerJSON[map[string]string](t, b)["ok"] == "" {
		t.Fatalf("ARCA lo rechaza: %d %s", st, b)
	}

	// La nota de crédito solo del renglón exento no devuelve percepción: no
	// se cobró sobre él.
	c, _ := e.s.Obtener(context.Background(), id)
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/nota-de-credito",
		map[string]any{"motivo": "Devolvió el libro", "parciales": []map[string]any{{"itemId": c.Items[1].ID, "cantidad": 1}}})
	if st != 200 {
		t.Fatalf("nota: %d %s", st, b)
	}
	nc, _ := e.s.Obtener(context.Background(), leerJSON[map[string]string](t, b)["invoiceId"])
	if nc.Total != "1000.00" || nc.Neto != "0.00" || nc.Exento != "1000.00" {
		t.Fatalf("nota del exento: total %s, neto %s, exento %s", nc.Total, nc.Neto, nc.Exento)
	}
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+nc.ID+"/autorizar", nil)
	if st != 200 || leerJSON[map[string]string](t, b)["ok"] == "" {
		t.Fatalf("la nota: %d %s", st, b)
	}
}

// autorizarPorAPI pide el CAE y falla si ARCA no lo da.
func autorizarPorAPI(t *testing.T, e *entorno, admin *http.Client, id string) {
	t.Helper()
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/autorizar", nil)
	if st != 200 || leerJSON[map[string]string](t, b)["ok"] == "" {
		t.Fatalf("autorizar: %d %s", st, b)
	}
}

// **Notas sobre notas.** Una nota de crédito se revierte con una nota de
// débito de la misma letra, y una nota de débito se anula con una nota de
// crédito. El TS solo reemplazaba el prefijo «factura»: sobre una nota
// devolvía el mismo tipo, y la nota de débito sobre una nota de crédito
// salía como crédito (y al revés), con el signo de la cuenta corriente al
// revés.
func TestNotasSobreNotas(t *testing.T) {
	e := armar(t, true)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	ctx := context.Background()
	campos := map[string]string{"receptorNombre": "Gómez SRL", "receptorCuit": "30-71234567-1", "receptorCondicionIva": "responsable_inscripto",
		"guardarComoCliente": "on"}
	_, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(campos, [4]string{"Fenólico", "10", "12100", "21"}))
	fa := leerJSON[map[string]string](t, b)["invoiceId"]
	autorizarPorAPI(t, e, admin, fa)
	c, _ := e.s.Obtener(ctx, fa)
	cliente := *c.CustomerID
	saldo := func() float64 {
		var s float64
		e.uno(t, `SELECT sum(monto)::float8 FROM account_movements WHERE customer_id = $1`, &s, cliente)
		return s
	}

	// La nota de crédito parcial de la factura (2 placas).
	_, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+fa+"/nota-de-credito",
		map[string]any{"motivo": "Devolvió dos", "parciales": []map[string]any{{"itemId": c.Items[0].ID, "cantidad": 2}}})
	nc, _ := e.s.Obtener(ctx, leerJSON[map[string]string](t, b)["invoiceId"])
	if nc.Tipo != "nota_credito_a" {
		t.Fatalf("la nota de la factura: %s", nc.Tipo)
	}
	autorizarPorAPI(t, e, admin, nc.ID)
	if s := saldo(); s != 121000-24200 {
		t.Fatalf("saldo después de la nota de crédito: %v", s)
	}

	// Anular la nota de crédito: una nota de débito A, que vuelve a cargar.
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+nc.ID+"/anular", map[string]string{"motivo": "Al final no devolvió"})
	if st != 200 {
		t.Fatalf("anular la nota: %d %s", st, b)
	}
	nd, _ := e.s.Obtener(ctx, leerJSON[map[string]string](t, b)["invoiceId"])
	if nd.Tipo != "nota_debito_a" || nd.Total != "24200.00" {
		t.Fatalf("el reverso de la nota de crédito: %s %s", nd.Tipo, nd.Total)
	}
	autorizarPorAPI(t, e, admin, nd.ID)
	if s := saldo(); s != 121000 {
		t.Fatalf("saldo después de revertir la nota de crédito: %v", s)
	}

	// Un cargo sobre la factura (nota de débito) y su anulación: una nota de
	// crédito que descuenta.
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+fa+"/nota-de-debito",
		map[string]any{"motivo": "Flete olvidado", "concepto": "Flete", "importe": 12100, "alicuota": 21})
	if st != 200 {
		t.Fatalf("débito: %d %s", st, b)
	}
	flete, _ := e.s.Obtener(ctx, leerJSON[map[string]string](t, b)["invoiceId"])
	autorizarPorAPI(t, e, admin, flete.ID)
	if s := saldo(); s != 133100 {
		t.Fatalf("saldo con el flete: %v", s)
	}
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+flete.ID+"/anular", map[string]string{"motivo": "El flete era gratis"})
	if st != 200 {
		t.Fatalf("anular el débito: %d %s", st, b)
	}
	ncFlete, _ := e.s.Obtener(ctx, leerJSON[map[string]string](t, b)["invoiceId"])
	if ncFlete.Tipo != "nota_credito_a" {
		t.Fatalf("el reverso de la nota de débito: %s", ncFlete.Tipo)
	}
	autorizarPorAPI(t, e, admin, ncFlete.ID)
	if s := saldo(); s != 121000 {
		t.Fatalf("saldo final: %v", s)
	}
}

// **El mismo renglón acreditado dos veces.** El tope de una nota parcial era
// la cantidad facturada, no lo que queda: dos notas de 6 sobre 10 placas
// pasaban (el tope del total no lo frenaba si la factura tenía otros
// renglones), y una sola nota con el renglón repetido también.
func TestNotaParcialRespetaLoQueQueda(t *testing.T) {
	e := armar(t, true)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	ctx := context.Background()
	_, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(consumidor(),
		[4]string{"Fenólico", "10", "12100", "21"}, [4]string{"Machimbre", "100", "1210", "21"}))
	id := leerJSON[map[string]string](t, b)["invoiceId"]
	autorizarPorAPI(t, e, admin, id)
	c, _ := e.s.Obtener(ctx, id)
	placas := c.Items[0].ID
	nota := func(parciales ...map[string]any) (int, string) {
		st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/nota-de-credito",
			map[string]any{"motivo": "Devolución", "parciales": parciales})
		return st, string(b)
	}
	// Una sola nota con el renglón dos veces: 6 + 6 de 10.
	if st, b := nota(map[string]any{"itemId": placas, "cantidad": 6}, map[string]any{"itemId": placas, "cantidad": 6}); st != 422 ||
		!strings.Contains(b, `ya se acreditaron 6 de 10: quedan 4.`) {
		t.Fatalf("renglón repetido: %d %s", st, b)
	}
	if st, b := nota(map[string]any{"itemId": placas, "cantidad": 6}); st != 200 {
		t.Fatalf("la primera: %d %s", st, b)
	}
	// Otra de 6: quedan 4.
	if st, b := nota(map[string]any{"itemId": placas, "cantidad": 6}); st != 422 || !strings.Contains(b, `quedan 4.`) {
		t.Fatalf("la segunda: %d %s", st, b)
	}
	if st, b := nota(map[string]any{"itemId": placas, "cantidad": 4}); st != 200 {
		t.Fatalf("lo que queda: %d %s", st, b)
	}
	// Anular acredita solo el machimbre.
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/anular", map[string]string{"motivo": "Error de carga"})
	if st != 200 {
		t.Fatalf("anular: %d %s", st, b)
	}
	resto, _ := e.s.Obtener(ctx, leerJSON[map[string]string](t, b)["invoiceId"])
	if len(resto.Items) != 1 || resto.Total != "121000.00" {
		t.Fatalf("anulación: %d renglones, %s", len(resto.Items), resto.Total)
	}
}

// pedidoConAlicuotas arma un pedido con tres renglones: uno al 10,5 % guardado
// en el renglón (el producto hoy está al 21 %), uno exento guardado y uno
// viejo sin alícuota guardada (vale la del producto, 10,5 %).
func pedidoConAlicuotas(t *testing.T, e *entorno) string {
	t.Helper()
	var cat, al21, al105, v21, v105, pedido string
	e.uno(t, `INSERT INTO categories (slug, name, description) VALUES ('varios', 'Varios', '') RETURNING id`, &cat)
	e.uno(t, `INSERT INTO products (slug, name, category_id, description, alicuota_iva) VALUES ('harina', 'Harina', $1, '', 21) RETURNING id`, &al21, cat)
	e.uno(t, `INSERT INTO products (slug, name, category_id, description, alicuota_iva) VALUES ('leña', 'Leña', $1, '', 10.5) RETURNING id`, &al105, cat)
	e.uno(t, `INSERT INTO product_variants (product_id, sku, label) VALUES ($1, 'HAR', '1 kg') RETURNING id`, &v21, al21)
	e.uno(t, `INSERT INTO product_variants (product_id, sku, label) VALUES ($1, 'LEN', '10 kg') RETURNING id`, &v105, al105)
	e.uno(t, `INSERT INTO orders (numero, contacto_nombre, costo_envio, total) VALUES ('PED-2000', 'Ana', 0, 4420) RETURNING id`, &pedido)
	e.exec(t, `INSERT INTO order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, alicuota_iva, orden)
		VALUES ($1, $2, 'Harina', 'unidad', 2, 1105, 2210, 10.5, 0), ($1, NULL, 'Libro', 'unidad', 1, 1000, 1000, 0, 1),
		($1, $3, 'Leña', 'unidad', 1, 1210, 1210, NULL, 2)`, pedido, v21, v105)
	return pedido
}

// alicuotasFacturadas son las alícuotas de los renglones del comprobante.
func alicuotasFacturadas(t *testing.T, e *entorno, invoiceID string) string {
	t.Helper()
	var s string
	e.uno(t, `SELECT string_agg(alicuota_iva::text, ' ' ORDER BY orden) FROM invoice_items WHERE invoice_id = $1`, &s, invoiceID)
	return s
}

// **El mostrador facturaba todo al 21 %.** La venta no trae la alícuota y el
// comprobante salía sin ella (21 por defecto), también lo exento o al 10,5.
// Y facturar un pedido leía la alícuota del producto de hoy, no la que quedó
// guardada en el renglón al vender.
func TestLaAlicuotaSaleDelRenglonDelPedido(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	pedido := pedidoConAlicuotas(t, e)
	r, err := e.s.EmitirParaLaVenta(ctx, PedidoDeComprobante{OrderID: pedido, ReceptorNombre: "Mostrador", UsuarioID: "u",
		Lineas: []LineaDeVenta{{Descripcion: "Harina", Unidad: "unidad", Cantidad: 2, PrecioUnitario: 1105},
			{Descripcion: "Libro", Unidad: "unidad", Cantidad: 1, PrecioUnitario: 1000},
			{Descripcion: "Leña", Unidad: "unidad", Cantidad: 1, PrecioUnitario: 1210}}})
	if err != nil || r.InvoiceID == nil {
		t.Fatalf("mostrador: %v %+v", err, r)
	}
	if a := alicuotasFacturadas(t, e, *r.InvoiceID); a != "10.50 0.00 10.50" {
		t.Fatalf("alícuotas del mostrador: %s", a)
	}
	// El mismo pedido facturado desde el panel (el del mostrador se anula
	// antes: un pedido tiene un solo comprobante vivo).
	e.exec(t, `UPDATE invoices SET estado = 'anulada' WHERE id = $1`, *r.InvoiceID)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+pedido+"/facturar", nil)
	if st != 200 {
		t.Fatalf("facturar: %d %s", st, b)
	}
	if a := alicuotasFacturadas(t, e, leerJSON[map[string]string](t, b)["invoiceId"]); a != "10.50 0.00 10.50" {
		t.Fatalf("alícuotas del pedido: %s", a)
	}
}

// **Una A sin CUIT, o con uno mal tipeado.** En el mostrador cualquier CUIT
// sin ficha daba A (un monotributista con CUIT 20 también), y un CUIT con el
// verificador mal iba igual a ARCA. La factura manual a un «responsable
// inscripto» sin CUIT salía como A con DocTipo 99, que ARCA rechaza.
func TestFacturaASoloConCuitValido(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	emitir := func(campos map[string]string) (int, string) {
		st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(campos, [4]string{"Fenólico", "1", "12100", "21"}))
		return st, string(b)
	}
	if st, b := emitir(map[string]string{"receptorNombre": "Gómez SRL", "receptorCondicionIva": "responsable_inscripto"}); st != 422 ||
		!strings.Contains(b, "hace falta su CUIT") {
		t.Fatalf("A sin CUIT: %d %s", st, b)
	}
	if st, b := emitir(map[string]string{"receptorNombre": "Gómez SRL", "receptorCuit": "30-71234567-2", "receptorCondicionIva": "responsable_inscripto"}); st != 422 ||
		!strings.Contains(b, "El CUIT no es válido") {
		t.Fatalf("CUIT con el verificador mal: %d %s", st, b)
	}
	var n int
	e.uno(t, `SELECT count(*) FROM invoices`, &n)
	if n != 0 {
		t.Fatalf("se emitieron %d", n)
	}

	// Mostrador: un CUIT de persona sin ficha es B, con el CUIT informado.
	venta := func(cuit string) ResultadoComprobante {
		r, err := e.s.EmitirParaLaVenta(ctx, PedidoDeComprobante{ReceptorNombre: "Mostrador", Cuit: &cuit, UsuarioID: "u",
			Lineas: []LineaDeVenta{{Descripcion: "Clavos", Unidad: "kg", Cantidad: 2, PrecioUnitario: 1500}}})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	r := venta("20-12345678-6")
	if r.InvoiceID == nil {
		t.Fatalf("mostrador: %+v", r)
	}
	c, _ := e.s.Obtener(ctx, *r.InvoiceID)
	if c.Tipo != "factura_b" || c.ReceptorCuit == nil || *c.ReceptorCuit != "20123456786" || c.ReceptorCondicionIva != "consumidor_final" {
		t.Fatalf("CUIT 20 en el mostrador: %s %v %s", c.Tipo, c.ReceptorCuit, c.ReceptorCondicionIva)
	}
	// Uno de empresa, A.
	r = venta("30-71234567-1")
	c, _ = e.s.Obtener(ctx, *r.InvoiceID)
	if c.Tipo != "factura_a" {
		t.Fatalf("CUIT 30 en el mostrador: %s", c.Tipo)
	}
	// Mal tipeado: la venta queda, el comprobante no se emite.
	if r = venta("30-71234567-2"); r.InvoiceID != nil || !strings.Contains(r.Aviso, "El CUIT no es válido") {
		t.Fatalf("CUIT inválido en el mostrador: %+v", r)
	}
}
