package mostrador

import (
	"context"
	"strings"
	"testing"
	"time"

	"mjbj/internal/caja"
	"mjbj/internal/reglas"
	"mjbj/internal/sqlc"
	"mjbj/internal/zodjs"
)

// Lo que encontró el segundo y el tercer mes simulado en la venta del
// mostrador (rama mes23-mostrador-caja).

// M2S1-178, M2S2-133 y M3S2-060: Rehacer devuelve el cliente, el papel y el
// cheque con sus datos, además de los renglones.
func TestMes23RehacerConservaClienteYCheque(t *testing.T) {
	e := armar(t)
	adm := e.conPIN(t)
	fecha := time.Now().In(caja.Argentina).AddDate(0, 0, 10).Format("2006-01-02")
	v := e.venta("cheque", e.lineaPlaca(1))
	v["customerId"], v["contactoNombre"] = e.cliente, "Ana Gómez"
	v["pagos"] = []any{map[string]any{"medio": "cheque", "importe": 45000.5,
		"cheque": map[string]any{"tipo": "fisico", "numero": "55501234", "banco": "Banco Provincia", "fechaPago": fecha, "librador": "Ana Gómez"}}}
	st, m, b := pedir(t, adm, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["ok"] != true {
		t.Fatalf("venta: %d %s", st, b)
	}
	st, r, b := pedir(t, adm, "POST", e.u+"/api/v1/mostrador/ventas/"+m["orderId"].(string)+"/anular",
		map[string]any{"motivo": "Rehacer", "rehacer": true})
	if st != 200 || r["ok"] == nil {
		t.Fatalf("anular: %d %s", st, b)
	}
	if r["customerId"] != e.cliente || r["comprobante"] != "interno" {
		t.Errorf("cliente y papel: %s", b)
	}
	pagos, _ := r["pagos"].([]any)
	if len(pagos) != 1 {
		t.Fatalf("pagos: %s", b)
	}
	ch, _ := pagos[0].(map[string]any)["cheque"].(map[string]any)
	if ch == nil || ch["numero"] != "55501234" || ch["banco"] != "Banco Provincia" || ch["fechaPago"] != fecha || ch["librador"] != "Ana Gómez" {
		t.Errorf("el cheque no vuelve: %s", b)
	}
}

// M2S3-047: rehacer una venta con corte deja el corte en la cola, sin
// venta, y la venta rehecha lo ata en vez de crear otro.
func TestMes23RehacerConCorteNoCreaOtro(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.conPIN(t)
	k := e.corteDePrueba(piezaDeCorte(1100, 800, 2))
	v := e.venta("transferencia", e.renglonesDelCorte(t, 0, k, 0)...)
	v["cortes"] = []any{k}
	st, m, b := pedir(t, adm, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["ok"] != true {
		t.Fatalf("venta: %d %s", st, b)
	}
	corte := e.txt(t, `select id::text from cutting_orders where order_id = $1`, m["orderId"])
	st, r, b := pedir(t, adm, "POST", e.u+"/api/v1/mostrador/ventas/"+m["orderId"].(string)+"/anular",
		map[string]any{"motivo": "Era Factura", "rehacer": true})
	if st != 200 || r["ok"] == nil {
		t.Fatalf("anular: %d %s", st, b)
	}
	cortes, _ := r["cortes"].([]any)
	if len(cortes) != 1 || cortes[0] != corte {
		t.Fatalf("el corte para rehacer: %s", b)
	}
	if est := e.txt(t, `select estado::text || ':' || coalesce(order_id::text, '-') from cutting_orders where id = $1`, corte); est != "en-cola:-" {
		t.Errorf("el corte quedó %s", est)
	}
	k["existente"] = corte
	c, _ := e.svc.planoDelCorte(ctx, *leerCorte(zodjs.Raiz(aJSON(t, k))))
	_ = c
	v = e.venta("transferencia", e.renglonesDelCorte(t, 0, k, 0)...)
	v["cortes"] = []any{k}
	if st, m2, b := pedir(t, adm, "POST", e.u+"/api/v1/mostrador/ventas", v); st != 200 || m2["ok"] != true {
		t.Fatalf("rehecha: %d %s", st, b)
	}
	if n := e.num(t, `select count(*)::float8 from cutting_orders`); n != 1 {
		t.Errorf("hay %v cortes", n)
	}

	// Sin rehacer, el corte se cae como siempre.
	v = e.venta("transferencia", e.renglonesDelCorte(t, 0, e.corteDePrueba(piezaDeCorte(1100, 800, 2)), 0)...)
	v["cortes"] = []any{e.corteDePrueba(piezaDeCorte(1100, 800, 2))}
	_, m3, _ := pedir(t, adm, "POST", e.u+"/api/v1/mostrador/ventas", v)
	pedir(t, adm, "POST", e.u+"/api/v1/mostrador/ventas/"+m3["orderId"].(string)+"/anular", map[string]any{"motivo": "No va"})
	if est := e.txt(t, `select estado::text from cutting_orders where order_id = $1`, m3["orderId"]); est != "cancelado" {
		t.Errorf("anulada sin rehacer, el corte quedó %s", est)
	}
	_ = sqlc.StaffRoleAdmin
}

// M2S1-187: «laca» trae las lacas y no las placas; lo que solo aparece en el
// medio de una palabra queda para cuando no hay otra cosa.
func TestMes23LacaNoTraePlacas(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	cat := e.txt(t, `select id::text from categories limit 1`)
	laca := e.txt(t, `insert into products (slug, name, category_id, description, unit) values ('laca', 'Laca Poliuretánica', $1, '', 'unidad') returning id::text`, cat)
	e.txt(t, `insert into product_variants (product_id, sku, label) values ($1, 'LAC-4', '4 litros') returning id::text`, laca)
	r, err := e.svc.Buscar(ctx, "laca", e.central, nil)
	if err != nil || len(r) != 1 || r[0].Producto != "Laca Poliuretánica" {
		t.Fatalf("laca: %+v %v", r, err)
	}
	// Sin nada que empiece así, lo de adentro de una palabra sigue apareciendo.
	r, err = e.svc.Buscar(ctx, "enoli", e.central, nil)
	if err != nil || len(r) != 1 {
		t.Fatalf("enoli: %+v %v", r, err)
	}
}

// M3S4-015: la misma venta al mismo cliente, recién, se pregunta antes de
// cobrarla otra vez; confirmada, sale.
func TestMes23VentaRepetidaSePregunta(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	nueva := func() map[string]any {
		v := e.venta("transferencia", e.lineaPlaca(2))
		v["customerId"], v["contactoNombre"] = e.cliente, "Ana Gómez"
		return v
	}
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", nueva()); m["ok"] != true {
		t.Fatalf("primera: %s", b)
	}
	v := nueva()
	_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if m["ok"] != false || m["repetida"] == nil {
		t.Fatalf("la segunda igual no se preguntó: %s", b)
	}
	v["repetidaOk"] = true
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); m["ok"] != true {
		t.Fatalf("confirmada: %s", b)
	}
	// Otra cantidad no es la misma venta.
	otra := e.venta("transferencia", e.lineaPlaca(3))
	otra["customerId"], otra["contactoNombre"] = e.cliente, "Ana Gómez"
	if _, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", otra); m["ok"] != true {
		t.Fatalf("otra venta: %s", b)
	}
}

// M2S2-062 y M3S4-041: cobrar un corte de la cola trae a su cliente, o el
// nombre y el teléfono que se anotaron.
func TestMes23ElCorteTraeSuCliente(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	cobrar := func(existente string) string {
		k := e.corteDePrueba(piezaDeCorte(1100, 800, 2))
		k["existente"] = existente
		c, _ := e.svc.planoDelCorte(ctx, *leerCorte(zodjs.Raiz(aJSON(t, k))))
		_ = c
		v := e.venta("transferencia", e.renglonesDelCorte(t, 0, k, 0)...)
		v["cortes"] = []any{k}
		_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
		if m["ok"] != true {
			t.Fatalf("cobrar: %s", b)
		}
		return m["orderId"].(string)
	}
	conFicha := e.txt(t, `insert into cutting_orders (numero, customer_id, contacto_nombre, branch_id, variant_id, material_descripcion, placas, pasadas, estado)
		values ('CRT-8', $1, 'Ana Gómez', $2, $3, 'Fenólico 18 mm', 1, 0, 'terminado') returning id::text`, e.cliente, e.central, e.placa)
	p := cobrar(conFicha)
	if got := e.txt(t, `select coalesce(customer_id::text, '-') || ':' || contacto_nombre from orders where id = $1`, p); got != e.cliente+":Ana Gómez" {
		t.Errorf("con ficha: %s", got)
	}
	porTelefono := e.txt(t, `insert into cutting_orders (numero, contacto_nombre, contacto_telefono, branch_id, variant_id, material_descripcion, placas, pasadas, estado)
		values ('CRT-57', 'Marta Teléfono', '223 555-0612', $1, $2, 'Fenólico 18 mm', 1, 0, 'terminado') returning id::text`, e.central, e.placa)
	p = cobrar(porTelefono)
	if got := e.txt(t, `select contacto_nombre || ':' || coalesce(contacto_telefono, '-') from orders where id = $1`, p); got != "Marta Teléfono:223 555-0612" {
		t.Errorf("sin ficha: %s", got)
	}
}

// M3S1-061: con cuánto pagó queda en la venta, para el vuelto del ticket.
func TestMes23ConCuantoPago(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1000)
	v := e.venta("efectivo", map[string]any{"variantId": e.tornillo, "descripcion": "Tornillo", "unidad": "unidad", "cantidad": 2, "precioUnitario": 150})
	v["efectivoRecibido"] = 500
	_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if m["ok"] != true {
		t.Fatalf("venta: %s", b)
	}
	if r := e.num(t, `select coalesce(efectivo_recibido, -1)::float8 from orders where id = $1`, m["orderId"]); r != 500 {
		t.Errorf("recibido: %v", r)
	}
}

// M2S2-018: con la regla en «suma», el descuento tipeado va además del 10 %
// de efectivo; con «reemplaza» (la de arranque), en su lugar.
func TestMes23DescuentoConEscala(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1000)
	if _, err := e.pool.Exec(ctx, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta, activo) values ('efectivo', 0, 10, '10% en efectivo', true)`); err != nil {
		t.Skipf("sin escalas en esta base: %v", err)
	}
	cobrar := func() float64 {
		v := e.venta("efectivo", map[string]any{"variantId": e.tornillo, "descripcion": "Tornillo", "unidad": "unidad", "cantidad": 100, "precioUnitario": 150})
		v["descuento"], v["descuentoMotivo"] = 750, "Cliente de siempre"
		_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
		if m["ok"] != true {
			t.Fatalf("venta: %s", b)
		}
		return m["total"].(float64)
	}
	if tot := cobrar(); tot != 14250 {
		t.Errorf("reemplaza: %v", tot)
	}
	if err := reglas.Fijar(ctx, e.pool, reglas.DescuentoConEscala, "suma"); err != nil {
		t.Fatal(err)
	}
	if tot := cobrar(); tot != 12750 {
		t.Errorf("suma: %v", tot)
	}
}

// M2S1-180: con la regla en «al_peso», lo pagado todo en efectivo va sin
// centavos; con «no», con sus centavos.
func TestMes23RedondeoDelEfectivo(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1000)
	cobrar := func(medio string) float64 {
		_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", e.venta(medio, e.lineaPlaca(1)))
		if m["ok"] != true {
			t.Fatalf("venta: %s", b)
		}
		return m["total"].(float64)
	}
	if tot := cobrar("efectivo"); tot != 45000.5 {
		t.Errorf("con centavos: %v", tot)
	}
	if err := reglas.Fijar(ctx, e.pool, reglas.RedondeoEfectivo, "al_peso"); err != nil {
		t.Fatal(err)
	}
	if tot := cobrar("efectivo"); tot != 45000 {
		t.Errorf("al peso: %v", tot)
	}
	if tot := cobrar("transferencia"); tot != 45000.5 {
		t.Errorf("la transferencia no se redondea: %v", tot)
	}
}

// M3S2-050: el segundo toque de «Presupuesto» con la misma clave devuelve el
// mismo presupuesto.
func TestMes23PresupuestoUnaVez(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	p := map[string]any{"branchId": e.central, "lineas": []any{e.lineaPlaca(1)}, "customerId": nil, "contactoNombre": "Consumidor final",
		"clave": "pres-8f2b5c1e-0001"}
	_, a, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/presupuestos", p)
	_, c, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/presupuestos", p)
	if a["quoteId"] == nil || a["quoteId"] != c["quoteId"] {
		t.Fatalf("dos presupuestos: %s", b)
	}
	if n := e.num(t, `select count(*)::float8 from quotes`); n != 1 {
		t.Errorf("presupuestos: %v", n)
	}
}

// M3S2-060: una venta del mostrador sin factura se devuelve por una parte:
// en efectivo por la caja (hasta lo cobrado en efectivo) o por el medio de
// pago, con el PIN para el vendedor.
func TestMes23DevolucionSinFactura(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.conPIN(t)
	e.abrir(t, ven, e.central, 1000)
	tornillos := func(medio string) string {
		_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas",
			e.venta(medio, map[string]any{"variantId": e.tornillo, "descripcion": "Tornillo", "unidad": "unidad", "cantidad": 4, "precioUnitario": 150}))
		if m["ok"] != true {
			t.Fatalf("venta: %s", b)
		}
		return m["orderId"].(string)
	}
	efectivo := tornillos("efectivo")
	u := e.u + "/api/v1/mostrador/ventas/" + efectivo + "/devolucion-sin-factura"
	st, datos, b := pedir(t, ven, "GET", u, nil)
	if st != 200 || datos["efectivo"] != 600.0 {
		t.Fatalf("datos: %d %s", st, b)
	}
	item := datos["renglones"].([]any)[0].(map[string]any)["orderItemId"]
	pedido := map[string]any{"clave": "dev-sf-0001", "destino": "caja", "motivo": "Le sobró uno",
		"renglones": []any{map[string]any{"orderItemId": item, "cantidad": 1}}}
	if _, m, b := pedir(t, ven, "POST", u, pedido); m["autorizacion"] == nil {
		t.Fatalf("sin PIN devolvió: %s", b)
	}
	pedido["pin"] = pinDeLaDuena
	if st, m, b := pedir(t, ven, "POST", u, pedido); st != 200 || m["ok"] == nil {
		t.Fatalf("con PIN: %d %s", st, b)
	}
	ab, _ := caja.Abierto(context.Background(), e.pool, e.central)
	if ab.Devoluciones != -150 {
		t.Errorf("la caja no devolvió: %+v", ab)
	}
	// La de transferencia no sale de la caja.
	transf := tornillos("transferencia")
	u = e.u + "/api/v1/mostrador/ventas/" + transf + "/devolucion-sin-factura"
	_, datos, _ = pedir(t, ven, "GET", u, nil)
	item = datos["renglones"].([]any)[0].(map[string]any)["orderItemId"]
	pedido = map[string]any{"clave": "dev-sf-0002", "destino": "caja", "motivo": "Le sobró uno", "pin": pinDeLaDuena,
		"renglones": []any{map[string]any{"orderItemId": item, "cantidad": 1}}}
	if st, _, b := pedir(t, ven, "POST", u, pedido); st != 422 {
		t.Fatalf("efectivo de una transferencia: %d %s", st, b)
	}
	pedido["destino"], pedido["clave"] = "afuera", "dev-sf-0003"
	if st, m, b := pedir(t, ven, "POST", u, pedido); st != 200 || m["ok"] == nil {
		t.Fatalf("por afuera: %d %s", st, b)
	}
	z, _ := caja.CierreDelTurno(context.Background(), e.pool, e.sesionAbierta(t))
	var medios []string
	for _, r := range z {
		if r.Devolucion {
			medios = append(medios, r.MedioPago)
		}
	}
	if strings.Join(medios, ",") != "efectivo,transferencia" && strings.Join(medios, ",") != "transferencia,efectivo" {
		t.Errorf("el Z: %+v", z)
	}
}

// M3S1-064: «se vendió más de lo que hay» dice para quién está apartado lo
// que queda en el estante.
func TestMes23VendidoDeMasDiceLasReservas(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	web := e.txt(t, `insert into orders (numero, contacto_nombre, branch_id, origen) values ('PED-1204', 'Web', $1, 'tienda') returning id::text`, e.central)
	item := e.txt(t, `insert into order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal) values ($1, $2, 'Fenólico', 'placa', 100, 1, 100) returning id::text`, web, e.placa)
	e.txt(t, `insert into stock_reservations (order_id, order_item_id, variant_id, branch_id, cantidad) values ($1, $2, $3, $4, 100) returning id::text`, web, item, e.placa, e.central)
	e.txt(t, `update inventory set reservado = 100 where variant_id = $1 and branch_id = $2 returning variant_id::text`, e.placa, e.central)
	_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", e.venta("transferencia", e.lineaPlaca(1)))
	aviso, _ := m["avisoStock"].(string)
	if m["ok"] != true || !strings.Contains(aviso, "PED-1204") {
		t.Errorf("aviso: %s", b)
	}
}
