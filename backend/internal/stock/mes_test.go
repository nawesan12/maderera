package stock

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
)

// Lo que encontró el mes simulado en producción, área stock.

func (e *entorno) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func (e *entorno) uno(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var s string
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&s); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return s
}

func grilla(t *testing.T, e *entorno, c *http.Client, q string) GrillaDeStock {
	t.Helper()
	codigo, b := pedir(t, c, "GET", e.srv.URL+"/api/v1/admin/stock"+q, nil)
	if codigo != 200 {
		t.Fatalf("grilla %s: %d %s", q, codigo, b)
	}
	var g GrillaDeStock
	_ = json.Unmarshal([]byte(b), &g)
	return g
}

func movimientos(t *testing.T, e *entorno, c *http.Client, q string) []Movimiento {
	t.Helper()
	codigo, b := pedir(t, c, "GET", e.srv.URL+"/api/v1/admin/stock/movimientos"+q, nil)
	if codigo != 200 {
		t.Fatalf("movimientos %s: %d %s", q, codigo, b)
	}
	var m []Movimiento
	_ = json.Unmarshal([]byte(b), &m)
	return m
}

// pedidoEnCamino arma un pedido con una reserva activa de la placa en Casa
// Central, en el estado que se pida.
func (e *entorno) pedidoConReserva(t *testing.T, numero, estado string, cantidad float64) string {
	t.Helper()
	pedido := e.uno(t, `insert into orders (numero, contacto_nombre, branch_id, total, subtotal, estado)
		values ($1, 'Constructora', $2, 1, 1, $3::estado_pedido) returning id`, numero, e.central, estado)
	item := e.uno(t, `insert into order_items (order_id, variant_id, descripcion, cantidad, precio_unitario, subtotal)
		values ($1, $2, 'Fenólico 18', $3, 1, 1) returning id`, pedido, e.placa, cantidad)
	e.exec(t, `insert into stock_reservations (order_id, order_item_id, variant_id, branch_id, cantidad) values ($1, $2, $3, $4, $5)`,
		pedido, item, e.placa, e.central, cantidad)
	e.exec(t, `update inventory set reservado = reservado + $3 where variant_id = $1 and branch_id = $2`, e.placa, e.central, cantidad)
	return pedido
}

// H004, H062, H102, H358: «para reponer» es lo mismo en todas las pantallas.
// La sucursal en cero con mínimo cuenta (antes no), lo vendido de más cuenta
// aunque no haya mínimo, y los tres grupos no se pisan.
func TestParaReponerEsUnaSolaRegla(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	// El tornillo: 50 en Casa Central y nada en el Aserradero, mínimo 20 ahí.
	e.exec(t, `insert into inventory (variant_id, branch_id, qty, min_qty) values ($1, $2, 50, 0), ($1, $3, 0, 20)`, e.tornillo, e.central, e.aserradero)
	g := grilla(t, e, dep, "")
	if g.Conteos.Reponer != 2 || g.Conteos.SinStock != 0 || g.Conteos.ConStock != 0 || g.Conteos.Todas != 2 {
		t.Fatalf("conteos: %+v", g.Conteos)
	}
	if r := grilla(t, e, dep, "?estado=reponer"); r.Total != 2 {
		t.Errorf("la pestaña: %d", r.Total)
	}
	// Vendido de más, sin mínimo: 10 físicas y 25 reservadas en Casa Central.
	e.exec(t, `update inventory set min_qty = 0, reservado = 25 where variant_id = $1 and branch_id = $2`, e.placa, e.central)
	g = grilla(t, e, dep, "?busqueda=fenol")
	f := g.Filas[0]
	if !f.ParaReponer || f.Sucursales[0].Disponible != -15 || f.Total != 2 || f.Faltante != 15 || g.Conteos.Reponer != 1 {
		t.Errorf("faltante: %+v total %v", f.Sucursales[0], f.Total)
	}
	// Con todo bien, nada para reponer.
	e.exec(t, `update inventory set reservado = 0, min_qty = 0`)
	if g := grilla(t, e, dep, ""); g.Conteos.Reponer != 0 || g.Conteos.ConStock != 2 {
		t.Errorf("sin nada para reponer: %+v", g.Conteos)
	}
}

// H221 y H295: «2x4» encuentra el tirante de 2" x 4", y lo que empieza una
// palabra va primero (la laca antes que las placas).
func TestBuscarComoLoPideLaGente(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	cat := e.uno(t, `select id from categories limit 1`)
	tir := e.uno(t, `insert into products (slug, name, category_id, description, unit) values ('tirante', 'Tirante Pino Tratado 2" x 4" x 3.60m', $1, '', 'unidad') returning id`, cat)
	e.exec(t, `insert into product_variants (product_id, sku, label) values ($1, 'TEC-TIR-PIN-2436', '3,60 m')`, tir)
	laca := e.uno(t, `insert into products (slug, name, category_id, description, unit) values ('laca', 'Laca Poliuretánica', $1, '', 'unidad') returning id`, cat)
	e.exec(t, `insert into product_variants (product_id, sku, label) values ($1, 'LAC-4', '4 l')`, laca)
	e.exec(t, `update products set name = 'Placa Fenólica' where slug = 'fenolico'`)
	for _, q := range []string{"2x4", "tirante 2x4", "tirante pino 2x4", "2 x 4"} {
		if g := grilla(t, e, dep, "?busqueda="+strings.ReplaceAll(q, " ", "+")); g.Total != 1 || g.Filas[0].SKU != "TEC-TIR-PIN-2436" {
			t.Errorf("%q: %d", q, g.Total)
		}
	}
	g := grilla(t, e, dep, "?busqueda=laca")
	// La laca, la placa y la categoría «Placas» (el tornillo y el tirante).
	if g.Total != 4 || g.Filas[0].SKU != "LAC-4" {
		t.Errorf("laca primero: %d, %s", g.Total, g.Filas[0].SKU)
	}
}

// H206, H106, H326: los movimientos siguen al filtro, y cada uno dice qué
// fue y con qué comprobante.
func TestMovimientosDelFiltroYConSuNombre(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	u := e.srv.URL + "/api/v1/admin/stock/ajuste"
	for _, a := range []map[string]any{
		{"variantId": e.placa, "branchSlug": "casa-central", "cantidad": -1, "motivo": "rotura"},
		{"variantId": e.placa, "branchSlug": "casa-central", "cantidad": -1, "motivo": "devolucion"},
		{"variantId": e.tornillo, "branchSlug": "casa-central", "cantidad": 5, "motivo": "ingreso"},
	} {
		if c, b := pedir(t, dep, "POST", u, a); c != 200 {
			t.Fatalf("%v: %d %s", a, c, b)
		}
	}
	e.exec(t, `insert into inventory_movements (variant_id, branch_id, type, qty, note) values ($1, $2, 'venta', -10, 'Remito REM-0020')`, e.placa, e.central)
	todos := movimientos(t, e, dep, "")
	if len(todos) != 4 {
		t.Fatalf("todos: %d", len(todos))
	}
	m := movimientos(t, e, dep, "?busqueda=FEN18")
	if len(m) != 3 {
		t.Fatalf("filtrados: %d", len(m))
	}
	quiero := []struct{ concepto, ref string }{{"Entrega", "REM-0020"}, {"Al proveedor", ""}, {"Rotura", ""}}
	for i, q := range quiero {
		ref := ""
		if m[i].Referencia != nil {
			ref = *m[i].Referencia
		}
		if m[i].Concepto != q.concepto || ref != q.ref {
			t.Errorf("movimiento %d: %q %q, quiero %q %q", i, m[i].Concepto, ref, q.concepto, q.ref)
		}
	}
}

func TestConceptoDe(t *testing.T) {
	casos := []struct{ tipo, nota, doc, concepto, ref string }{
		{"egreso", "Rotura desde Stock (10 → 8)", "", "Rotura", ""},
		{"egreso", "Devolución al proveedor · NC 0003-00000121", "devolucion_proveedor", "Devolución", "NC 0003-00000121"},
		{"ajuste", "Anulación de la nota de crédito: error", "devolucion_proveedor", "Anulación de la devolución", ""},
		{"egreso", "Ajuste rápido desde Stock (3 → 2)", "", "Ajuste", ""},
		{"ingreso", "Devolución de cliente desde Stock (1 → 2)", "", "Devolución", ""},
		{"egreso", "Consumo del taller desde Stock (69 → 67,5)", "", "Consumo del taller", ""},
		{"egreso", "Reposición a cliente desde Stock (115 → 114) · PED-1098 · Ferreyra", "pedido", "Reposición a Ferreyra", "PED-1098"},
		{"egreso", "Reposición a cliente desde Stock (115 → 114) · PED-1098", "pedido", "Reposición a cliente", "PED-1098"},
		{"venta", "Remito REM-0020", "", "Entrega", "REM-0020"},
		{"venta", "Mostrador PED-1121", "", "Venta", "PED-1121"},
		{"devolucion", "Anulación PED-1121", "", "Anulación", "PED-1121"},
		{"ingreso", "Remito 0001-123", "recepcion", "Recepción", "0001-123"},
		{"transferencia_salida", "Traslado TRA-0003 a Aserradero", "", "Traslado", "TRA-0003"},
		{"ajuste", "Ajuste manual desde la ficha del producto (1 → 2)", "", "Ajuste en la ficha", ""},
		{"egreso", "", "", "Egreso", ""},
	}
	for _, c := range casos {
		if concepto, ref := ConceptoDe(c.tipo, c.nota, c.doc); concepto != c.concepto || ref != c.ref {
			t.Errorf("%s %q: %q %q", c.tipo, c.nota, concepto, ref)
		}
	}
}

// H166: lo que salió en el camión de un pedido «en camino» se ve aparte, y
// el conteo del galpón no lo descuenta dos veces.
func TestElConteoEsDelGalpon(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	// 10 físicas, 7 reservadas de antes; un pedido en camino se lleva 2 más
	// (el físico del sistema sigue en 10 hasta el remito).
	e.exec(t, `update inventory set reservado = 0 where variant_id = $1 and branch_id = $2`, e.placa, e.central)
	e.pedidoConReserva(t, "PED-1008", "en-camino", 2)
	e.pedidoConReserva(t, "PED-1009", "pendiente", 3)
	g := grilla(t, e, dep, "?busqueda=fenol")
	if s := g.Filas[0].Sucursales[0]; s.EnReparto != 2 || s.Galpon != 8 || s.Reservado != 5 || s.Disponible != 5 {
		t.Fatalf("en reparto: %+v", s)
	}
	u := e.srv.URL + "/api/v1/admin/stock/ajuste"
	// En el galpón hay 8 (10 − 2 en el camión): contar 8 coincide.
	if c, b := pedir(t, dep, "POST", u, map[string]any{"variantId": e.placa, "branchSlug": "casa-central", "cantidad": 0, "contado": 8}); c != 200 ||
		!strings.Contains(b, "el conteo coincide, 8") {
		t.Fatalf("conteo del galpón: %d %s", c, b)
	}
	if q := e.qty(t, e.placa, e.central); q != 10 {
		t.Fatalf("el conteo descontó lo del camión: %v", q)
	}
	// Contar 7 es una placa menos.
	if c, b := pedir(t, dep, "POST", u, map[string]any{"variantId": e.placa, "branchSlug": "casa-central", "cantidad": 0, "contado": 7}); c != 200 ||
		!strings.Contains(b, "10 → 9") {
		t.Fatalf("conteo con faltante: %d %s", c, b)
	}
}

// H398, H220, H275: lo contado puede ir con el motivo que explica la
// diferencia, el taller tiene su motivo, y la reposición a un cliente va
// atada a su pedido.
func TestMotivosNuevos(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	u := e.srv.URL + "/api/v1/admin/stock/ajuste"
	e.exec(t, `insert into inventory (variant_id, branch_id, qty) values ($1, $2, 248)`, e.tornillo, e.central)
	aj := func(cuerpo map[string]any) (int, string) {
		cuerpo["variantId"], cuerpo["branchSlug"] = e.tornillo, "casa-central"
		if _, ok := cuerpo["cantidad"]; !ok {
			cuerpo["cantidad"] = 0
		}
		return pedir(t, dep, "POST", u, cuerpo)
	}
	// Contar 230 con «Rotura»: el libro dice Rotura, no Egreso.
	if c, b := aj(map[string]any{"contado": 230, "motivo": "rotura"}); c != 200 || !strings.Contains(b, "248 → 230") {
		t.Fatalf("conteo con rotura: %d %s", c, b)
	}
	// Contar de más con «Rotura» no tiene sentido.
	if c, b := aj(map[string]any{"contado": 240, "motivo": "rotura"}); c != 422 || !strings.Contains(b, "resta") {
		t.Fatalf("rotura que suma: %d %s", c, b)
	}
	if c, b := aj(map[string]any{"cantidad": -2, "motivo": "taller"}); c != 200 || !strings.Contains(b, "230 → 228") {
		t.Fatalf("taller: %d %s", c, b)
	}
	if c, b := aj(map[string]any{"cantidad": 2, "motivo": "taller"}); c != 422 {
		t.Fatalf("taller que suma: %d %s", c, b)
	}
	// La reposición pide el pedido, y el pedido tiene que existir.
	if c, b := aj(map[string]any{"cantidad": -1, "motivo": "reposicion"}); c != 422 || !strings.Contains(b, "número del pedido") {
		t.Fatalf("reposición sin pedido: %d %s", c, b)
	}
	if c, b := aj(map[string]any{"cantidad": -1, "motivo": "reposicion", "pedido": "PED-9999"}); c != 422 || !strings.Contains(b, "PED-9999") {
		t.Fatalf("reposición de un pedido que no existe: %d %s", c, b)
	}
	cli := e.uno(t, `insert into customers (nombre) values ('Sim Carpintería Ferreyra') returning id`)
	pedido := e.uno(t, `insert into orders (numero, contacto_nombre, customer_id, branch_id, total, subtotal, estado)
		values ('PED-1098', 'Ferreyra', $1, $2, 1, 1, 'entregado') returning id`, cli, e.central)
	if c, b := aj(map[string]any{"cantidad": -1, "motivo": "reposicion", "pedido": "1098"}); c != 200 || !strings.Contains(b, "228 → 227") {
		t.Fatalf("reposición: %d %s", c, b)
	}
	if doc := e.uno(t, `select documento_id::text from inventory_movements where documento_tipo = 'pedido' and variant_id = $1`, e.tornillo); doc != pedido {
		t.Errorf("el movimiento no quedó atado al pedido: %s", doc)
	}
	if nota := e.uno(t, `select nota from order_status_history where order_id = $1`, pedido); !strings.Contains(nota, "Reposición sin cargo: 1 u. · Tornillo 6x40, de Casa Central") {
		t.Errorf("historial del pedido: %q", nota)
	}
	m := movimientos(t, e, dep, "?busqueda=TOR")
	if m[0].Concepto != "Reposición a Sim Carpintería Ferreyra" || m[0].Referencia == nil || *m[0].Referencia != "PED-1098" || m[2].Concepto != "Rotura" {
		t.Errorf("libro: %+v", m)
	}
}

// H009 y H112: un traslado lleva varias medidas, mueve media placa, dice
// cuánto hay en el origen si no alcanza, y el destino suma al recibir, una
// sola vez.
func TestTraslado(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	u := e.srv.URL + "/api/v1/admin/stock/traslados"
	e.exec(t, `insert into inventory (variant_id, branch_id, qty) values ($1, $2, 20)`, e.tornillo, e.central)
	traslado := func(renglones ...map[string]string) (int, string) {
		return pedir(t, dep, "POST", u, map[string]any{"origenId": e.central, "destinoId": e.aserradero, "nota": "Camión de la tarde", "renglones": renglones})
	}
	// En Casa Central hay 10 placas y 7 reservadas: 3 para mover.
	if c, b := traslado(map[string]string{"variantId": e.placa, "cantidad": "5"}); c != 422 || !strings.Contains(b, "Fenólico 18 mm: en Casa Central hay 3 para mover (7 reservados para clientes).") {
		t.Fatalf("sin stock: %d %s", c, b)
	}
	if c, b := traslado(map[string]string{"variantId": e.tornillo, "cantidad": "1,5"}); c != 422 || !strings.Contains(b, "sin decimales") {
		t.Fatalf("tornillo partido: %d %s", c, b)
	}
	c, b := traslado(map[string]string{"variantId": e.placa, "cantidad": "2,5"}, map[string]string{"variantId": e.tornillo, "cantidad": "12"})
	if c != 201 {
		t.Fatalf("traslado: %d %s", c, b)
	}
	var creado TrasladoCreado
	_ = json.Unmarshal([]byte(b), &creado)
	if creado.Codigo != "TRA-0001" {
		t.Errorf("número: %s", creado.Codigo)
	}
	// Salió del origen y todavía no llegó.
	if e.qty(t, e.placa, e.central) != 7.5 || e.qty(t, e.placa, e.aserradero) != 2 || e.qty(t, e.tornillo, e.central) != 8 {
		t.Fatalf("después de mandar: %v %v %v", e.qty(t, e.placa, e.central), e.qty(t, e.placa, e.aserradero), e.qty(t, e.tornillo, e.central))
	}
	if g := grilla(t, e, dep, "?busqueda=FEN18"); g.Filas[0].Sucursales[1].Llegando != 2.5 {
		t.Errorf("llegando: %+v", g.Filas[0].Sucursales[1])
	}
	if _, b := pedir(t, dep, "GET", u, nil); !strings.Contains(b, `"codigo":"TRA-0001"`) || !strings.Contains(b, `"estado":"en-camino"`) {
		t.Errorf("en camino: %s", b)
	}
	if _, b := pedir(t, dep, "GET", u+"/"+creado.ID, nil); !strings.Contains(b, `"cantidad":2.5`) || !strings.Contains(b, `"producto":"Fenólico"`) ||
		!strings.Contains(b, `"nota":"Camión de la tarde"`) {
		t.Errorf("comprobante: %s", b)
	}
	// Dos que reciben a la vez: suma una sola vez.
	var wg sync.WaitGroup
	codigos := make([]int, 4)
	for i := range codigos {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codigos[i], _ = pedir(t, dep, "POST", u+"/"+creado.ID+"/recibir", nil)
		}()
	}
	wg.Wait()
	ok := 0
	for _, c := range codigos {
		if c == 204 {
			ok++
		}
	}
	if ok != 1 {
		t.Errorf("recibido %d veces: %v", ok, codigos)
	}
	if e.qty(t, e.placa, e.aserradero) != 4.5 || e.qty(t, e.tornillo, e.aserradero) != 12 {
		t.Errorf("después de recibir: %v %v", e.qty(t, e.placa, e.aserradero), e.qty(t, e.tornillo, e.aserradero))
	}
	// Los movimientos cuadran con el stock y llevan el traslado.
	for _, suc := range []string{e.central, e.aserradero} {
		if n := e.uno(t, `select count(*)::text from inventory_movements where transfer_group = $1 and branch_id = $2`, creado.ID, suc); n != "2" {
			t.Errorf("movimientos en %s: %s", suc, n)
		}
	}
	m := movimientos(t, e, dep, "?busqueda=FEN18")
	if m[0].Concepto != "Traslado" || m[0].Referencia == nil || *m[0].Referencia != "TRA-0001" {
		t.Errorf("libro: %+v", m[0])
	}
}

// H166, tercera prueba: un envío que salió en parte. El remito del camión ya
// bajó del físico y es lo que va en reparto; la reserva que queda es lo que
// falta llevar y está en el galpón. Antes se leía «20 en reparto» con el
// pedido de remito anulado y el galpón restaba lo mismo dos veces.
func TestElEnvioEnParteNoRestaDosVeces(t *testing.T) {
	e := armar(t)
	dep := e.staff(t, "deposito@prueba.test", "deposito")
	e.exec(t, `update inventory set qty = 10, reservado = 0 where variant_id = $1 and branch_id = $2`, e.placa, e.central)
	pedido := e.pedidoConReserva(t, "PED-1208", "en-camino", 2)
	// Salieron 3 en el camión con REM-0011 (ya descontadas); un remito
	// anulado no cuenta.
	e.exec(t, `insert into deliveries (numero, order_id, branch_id, tipo, estado) values
		('REM-0011', $1, $2, 'envio', 'preparada'), ('REM-0010', $1, $2, 'envio', 'anulada')`, pedido, e.central)
	e.exec(t, `insert into inventory_movements (variant_id, branch_id, type, qty, note) values
		($1, $2, 'venta', -3, 'Remito REM-0011'), ($1, $2, 'venta', -4, 'Remito REM-0010'), ($1, $2, 'ingreso', 4, 'Remito REM-0010')`, e.placa, e.central)
	g := grilla(t, e, dep, "?busqueda=fenol")
	if s := g.Filas[0].Sucursales[0]; s.EnReparto != 3 || s.Galpon != 10 || s.Reservado != 2 {
		t.Fatalf("envío en parte: %+v", s)
	}
	// Firmado, ya no va en el camión.
	e.exec(t, `update deliveries set estado = 'entregada' where numero = 'REM-0011'`)
	if s := grilla(t, e, dep, "?busqueda=fenol").Filas[0].Sucursales[0]; s.EnReparto != 0 || s.Galpon != 10 {
		t.Fatalf("firmado: %+v", s)
	}
	// Contar 10 en el galpón coincide: la reserva que falta llevar está ahí.
	if c, b := pedir(t, dep, "POST", e.srv.URL+"/api/v1/admin/stock/ajuste",
		map[string]any{"variantId": e.placa, "branchSlug": "casa-central", "cantidad": 0, "contado": 10}); c != 200 ||
		!strings.Contains(b, "el conteo coincide, 10") {
		t.Fatalf("conteo: %d %s", c, b)
	}
}
