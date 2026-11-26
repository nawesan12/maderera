package cortes

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// Lo que encontró el mes simulado en producción en la cola y la ficha del
// corte. Cada prueba falla sin su arreglo.

func (e *entorno) txt(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var s string
	if err := e.pool.QueryRow(context.Background(), sql, args...).Scan(&s); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return s
}

// pedido arma un pedido con sus renglones, como los deja el presupuesto o el
// mostrador.
func (e *entorno) pedido(t *testing.T, numero string, lineas ...map[string]any) string {
	t.Helper()
	id := e.txt(t, `insert into orders (numero, contacto_nombre, customer_id, branch_id, subtotal, total, entregar_el)
		values ($1, 'Carpintería Gómez', $2, $3, 0, 0, '2026-12-04') returning id::text`, numero, e.cliente, e.central)
	for i, l := range lineas {
		if _, err := e.pool.Exec(context.Background(), `
			insert into order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, presentacion, del_corte, orden)
			values ($1, $2, $3, $4, $5::numeric, $6::numeric, $5::numeric * $6::numeric, $7, $8, $9)`,
			id, l["variante"], l["descripcion"], l["unidad"], l["cantidad"], l["precio"], l["presentacion"], l["delCorte"] == true, i); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.pool.Exec(context.Background(), `
		update orders o set subtotal = s.t, total = s.t from (select coalesce(sum(subtotal), 0) t from order_items where order_id = $1) s where o.id = $1`, id); err != nil {
		t.Fatal(err)
	}
	return id
}

func alta(t *testing.T, e *entorno, c *http.Client, cuerpo map[string]any) string {
	t.Helper()
	code, b := pedir(t, c, "POST", e.srv.URL+"/api/v1/admin/cortes", cuerpo)
	if code != 200 {
		t.Fatalf("alta: %d %s", code, b)
	}
	var m map[string]string
	_ = json.Unmarshal([]byte(b), &m)
	return m["id"]
}

func leerFicha(t *testing.T, e *entorno, c *http.Client, id string) map[string]any {
	t.Helper()
	code, b := pedir(t, c, "GET", e.srv.URL+"/api/v1/admin/cortes/"+id, nil)
	if code != 200 {
		t.Fatalf("ficha: %d %s", code, b)
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(b), &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func melamina(e *entorno, extra ...any) map[string]any {
	m := map[string]any{"contactoNombre": "Gómez", "materialDescripcion": "Melamina Blanca", "variantId": e.melamina,
		"customerId": e.cliente, "piezas": []any{pieza(1800, 1500, 1), pieza(600, 300, 3, "cantoLargo", 1)}}
	for i := 0; i+1 < len(extra); i += 2 {
		m[extra[i].(string)] = extra[i+1]
	}
	return m
}

// H043: un trabajo con piezas que no entran en la placa no va a la cola.
func TestAltaConPiezasQueNoEntran(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", map[string]any{
		"contactoNombre": "Lucía", "materialDescripcion": "Fenólico 18 mm", "variantId": e.fenolico,
		"piezas": []any{pieza(2600, 100, 2), pieza(600, 300, 1)},
	})
	if code != 422 || !strings.Contains(b, "Hay 2 piezas que no entran en la placa (2600 × 100 mm)") {
		t.Fatalf("alta imposible: %d %s", code, b)
	}
	if n := e.txt(t, `select count(*)::text from cutting_orders`); n != "0" {
		t.Errorf("quedaron %s cortes", n)
	}
}

// H113: las placas y las pasadas que se guardan son las del plano, no las que
// se tipearon; y el alta devuelve el id para ir a la ficha (H044).
func TestAltaGuardaLasPlacasDelPlano(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	id := alta(t, e, ven, map[string]any{
		"contactoNombre": "Ferreyra", "materialDescripcion": "Melamina", "variantId": e.melamina, "placas": "3",
		"piezas": []any{pieza(600, 300, 3)},
	})
	if id == "" {
		t.Fatal("el alta no devolvió el id")
	}
	if s := e.txt(t, `select placas::text || ' ' || (pasadas > 0)::text from cutting_orders`); s != "1 true" {
		t.Errorf("placas y pasadas guardadas: %s", s)
	}
	// Lo cargado antes del arreglo (3 placas para un plano de 1) se corrige
	// en la cola.
	if _, err := e.pool.Exec(context.Background(), `update cutting_orders set placas = 3`); err != nil {
		t.Fatal(err)
	}
	_, b := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/cortes", nil)
	if !strings.Contains(b, `"placas":1`) {
		t.Errorf("la tarjeta dice otras placas: %s", b)
	}
}

// H115 y H118: el aserradero empieza y termina; urgencias y entregas son del
// mostrador, y su ficha no trae importes ni el teléfono.
func TestElAserraderoNoDecideNiVePlata(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	ase := e.staff(t, "aserradero@prueba.test", "aserradero")
	id := alta(t, e, ven, melamina(e, "contactoTelefono", "223 555-0202"))
	u := e.srv.URL + "/api/v1/admin/cortes/" + id
	if code, b := pedir(t, ase, "POST", u+"/urgente", nil); code != 403 {
		t.Errorf("urgente desde el taller: %d %s", code, b)
	}
	f := leerFicha(t, e, ase, id)
	cuenta := f["cuenta"].(map[string]any)
	corte := f["corte"].(map[string]any)
	if f["sinPlata"] != true || f["tarifa"] != nil || cuenta["total"].(float64) != 0 || corte["telefono"] != nil || corte["precioPlaca"] != nil {
		t.Errorf("la ficha del taller trae plata: %v / %v", cuenta, corte)
	}
	if f := leerFicha(t, e, ven, id); f["sinPlata"] == true || f["cuenta"].(map[string]any)["total"].(float64) <= 0 {
		t.Errorf("la del vendedor quedó sin plata")
	}
	for _, paso := range []string{"en-cola", "en-proceso"} {
		if code, b := pedir(t, ase, "POST", u+"/avanzar?desde="+paso, nil); code != 200 {
			t.Fatalf("avanzar %s: %d %s", paso, code, b)
		}
	}
	if code, b := pedir(t, ase, "POST", u+"/avanzar?desde=terminado", nil); code != 403 || !strings.Contains(b, "mostrador") {
		t.Errorf("retirar desde el taller: %d %s", code, b)
	}
}

// H116 y H403: terminar con las pasadas confirmadas, y volver atrás un toque
// equivocado.
func TestTerminarConPasadasYDeshacer(t *testing.T) {
	e := armar(t)
	ase := e.staff(t, "aserradero@prueba.test", "aserradero")
	id := alta(t, e, ase, melamina(e))
	u := e.srv.URL + "/api/v1/admin/cortes/" + id
	if code, b := pedir(t, ase, "POST", u+"/volver?desde=en-cola", nil); code != 422 {
		t.Errorf("volver desde la cola: %d %s", code, b)
	}
	pedir(t, ase, "POST", u+"/avanzar?desde=en-cola", nil)
	if code, b := pedir(t, ase, "POST", u+"/avanzar?desde=en-proceso&pasadas=7", nil); code != 200 {
		t.Fatalf("terminar: %d %s", code, b)
	}
	if s := e.txt(t, `select estado::text || ' ' || pasadas || ' ' || (terminado_at is not null)::text from cutting_orders where id = $1`, id); s != "terminado 7 true" {
		t.Errorf("terminado: %s", s)
	}
	_, b := pedir(t, ase, "GET", e.srv.URL+"/api/v1/admin/cortes", nil)
	if !strings.Contains(b, `"salioAt":"`) {
		t.Errorf("la cola no dice cuándo salió: %s", b)
	}
	if code, b := pedir(t, ase, "POST", u+"/volver?desde=terminado", nil); code != 200 || !strings.Contains(b, "volvió a la máquina") {
		t.Fatalf("deshacer: %d %s", code, b)
	}
	if s := e.txt(t, `select estado::text || ' ' || (terminado_at is null)::text from cutting_orders where id = $1`, id); s != "en-proceso true" {
		t.Errorf("deshecho: %s", s)
	}
	// La pantalla vieja no deshace dos veces.
	if code, _ := pedir(t, ase, "POST", u+"/volver?desde=terminado", nil); code != 409 {
		t.Errorf("deshacer otra vez: %d", code)
	}
}

// H185, H228 y H280: un corte cargado mal se anula con motivo o se corrige
// con otro, que lo saca de la cola; y el de un pedido no va en otra placa sin
// confirmarlo.
func TestAnularYCorregir(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	ase := e.staff(t, "aserradero@prueba.test", "aserradero")
	pedido := e.pedido(t, "PED-1001", map[string]any{"variante": e.melamina, "descripcion": "Melamina Blanca", "unidad": "placa", "cantidad": 2, "precio": 84500})
	conPedido := func(extra ...any) map[string]any { return melamina(e, append([]any{"orderId", pedido}, extra...)...) }

	// Otra placa que la del pedido: se frena y se confirma.
	otra := conPedido("variantId", e.fenolico, "materialDescripcion", "Fenólico", "piezas", []any{pieza(600, 300, 1)})
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", otra); code != 422 || !strings.Contains(b, "El pedido PED-1001 vende Melamina Blanca") {
		t.Fatalf("otra placa: %d %s", code, b)
	}
	otra["otraPlaca"] = true
	malo := alta(t, e, ven, otra)

	// Corregirlo: el nuevo lo saca de la cola.
	if code, b := pedir(t, ase, "POST", e.srv.URL+"/api/v1/admin/cortes", conPedido("reemplaza", malo)); code != 403 {
		t.Errorf("corregir desde el taller: %d %s", code, b)
	}
	bueno := alta(t, e, ven, conPedido("reemplaza", malo))
	if s := e.txt(t, `select estado::text || ' ' || motivo_anulado from cutting_orders where id = $1`, malo); s != "cancelado Reemplazado por CRT-2" {
		t.Errorf("el malo: %s", s)
	}
	_, b := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/cortes?estado=en-cola", nil)
	if strings.Contains(b, malo) || !strings.Contains(b, bueno) {
		t.Errorf("la cola: %s", b)
	}

	// Anular: con motivo, solo antes de cortarlo, y no desde el taller.
	u := e.srv.URL + "/api/v1/admin/cortes/" + bueno + "/anular"
	if code, _ := pedir(t, ase, "POST", u, map[string]any{"motivo": "se cargó mal"}); code != 403 {
		t.Errorf("anular desde el taller: %d", code)
	}
	if code, b := pedir(t, ven, "POST", u, map[string]any{"motivo": " "}); code != 422 || !strings.Contains(b, "Decí por qué") {
		t.Errorf("sin motivo: %d %s", code, b)
	}
	if code, b := pedir(t, ven, "POST", u, map[string]any{"motivo": "El cliente lo canceló"}); code != 200 {
		t.Fatalf("anular: %d %s", code, b)
	}
	if code, b := pedir(t, ven, "POST", u, map[string]any{"motivo": "otra vez"}); code != 422 || !strings.Contains(b, "ya salió de la máquina") && !strings.Contains(b, "no se anula") {
		t.Errorf("anular dos veces: %d %s", code, b)
	}
}

// H348 y H251: el corte suelto con cargo no se entrega con un clic; pasa a
// pedido, con su cuenta y la mercadería reservada.
func TestCorteSueltoSeCobraEnUnPedido(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	id := alta(t, e, ven, melamina(e, "retiraEl", "2026-12-04", "contactoTelefono", "223 555-0388"))
	u := e.srv.URL + "/api/v1/admin/cortes/" + id
	for _, paso := range []string{"en-cola", "en-proceso"} {
		pedir(t, ven, "POST", u+"/avanzar?desde="+paso, nil)
	}
	if code, b := pedir(t, ven, "POST", u+"/avanzar?desde=terminado", nil); code != 409 || !strings.Contains(b, "no está cobrado") {
		t.Fatalf("retirar sin cobrar: %d %s", code, b)
	}
	f := leerFicha(t, e, ven, id)
	if f["modo"] != "suelto" {
		t.Fatalf("modo: %v", f["modo"])
	}
	total := f["cuenta"].(map[string]any)["total"].(float64)
	// Cargado sin sucursal, se retira donde se corta: el pedido decía
	// «Retira en» y nada más (mes simulado, PED-1158).
	aserradero := e.txt(t, `insert into branches (slug, name, sort_order) values ('aserradero', 'Aserradero', 2) returning id::text`)
	if _, err := e.pool.Exec(context.Background(), `update cutting_orders set branch_id = null where id = $1`, id); err != nil {
		t.Fatal(err)
	}
	code, b := pedir(t, ven, "POST", u+"/pedido", nil)
	if code != 200 || !strings.Contains(b, `"numero":"PED-`) {
		t.Fatalf("pasar a pedido: %d %s", code, b)
	}
	var p map[string]string
	_ = json.Unmarshal([]byte(b), &p)
	if s := e.txt(t, `select total::text || ' ' || origen::text || ' ' || coalesce(to_char(entregar_el, 'YYYY-MM-DD'), '-') || ' ' || coalesce(contacto_telefono, '-') from orders where id = $1`, p["id"]); s != fmtMonto(total)+" telefono 2026-12-04 223 555-0388" {
		t.Errorf("el pedido: %s (la ficha decía %v)", s, total)
	}
	// La placa que pasa la mitad se vende entera (y su corte va sin cargo),
	// más el tapacanto.
	if n := e.txt(t, `select string_agg(unidad || ' ' || cantidad::text, ', ' order by orden) from order_items where order_id = $1 and del_corte`, p["id"]); n != "placa 1.00, m 1.80" {
		t.Errorf("renglones del corte: %s", n)
	}
	if s := e.txt(t, `select contacto_telefono || ' ' || to_char(retira_el, 'YYYY-MM-DD') from cutting_orders where id = $1`, id); s != "223 555-0388 2026-12-04" {
		t.Errorf("el alta perdió el teléfono o el retiro: %s", s)
	}
	if s := e.txt(t, `select coalesce(branch_id::text, '-') from orders where id = $1`, p["id"]); s != aserradero {
		t.Errorf("la sucursal del pedido: %s", s)
	}
	if s := e.txt(t, `select order_id::text from cutting_orders where id = $1`, id); s != p["id"] {
		t.Errorf("el corte no quedó atado: %s", s)
	}
	if f := leerFicha(t, e, ven, id); f["modo"] != "vendido" || f["pedido"].(map[string]any)["cobrado"].(float64) != total {
		t.Errorf("la ficha después: %v %v", f["modo"], f["pedido"])
	}
	if code, b := pedir(t, ven, "POST", u+"/pedido", nil); code != 422 {
		t.Errorf("dos veces: %d %s", code, b)
	}
	// Atado a su pedido, se entrega cuando el pedido está cobrado (H173 y
	// H348): antes, el mismo aviso.
	if code, b := pedir(t, ven, "POST", u+"/avanzar?desde=terminado", nil); code != 409 || !strings.Contains(b, "no está cobrado") {
		t.Errorf("retirar con el pedido sin cobrar: %d %s", code, b)
	}
	if _, err := e.pool.Exec(context.Background(), `update orders set estado_pago = 'pagado' where id = $1`, p["id"]); err != nil {
		t.Fatal(err)
	}
	if code, b := pedir(t, ven, "POST", u+"/avanzar?desde=terminado", nil); code != 200 {
		t.Errorf("retirar ya cobrado en el pedido: %d %s", code, b)
	}
}

func fmtMonto(v float64) string {
	b, _ := json.Marshal(v)
	s := string(b)
	if !strings.Contains(s, ".") {
		s += ".00"
	} else if len(s)-strings.Index(s, ".") == 2 {
		s += "0"
	}
	return s
}

// H184, H232 y H114: el corte de un pedido no vuelve a cotizar las placas que
// el pedido vende, avisa la diferencia y deja los retales al cliente; el que
// vendió el mostrador muestra lo que se cobró, con el descuento de la venta.
func TestLaFichaSabeDeSuPedido(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	pedido := e.pedido(t, "PED-1059", map[string]any{"variante": e.melamina, "descripcion": "Melamina Blanca", "unidad": "placa", "cantidad": 3, "precio": 84500})
	id := alta(t, e, ven, melamina(e, "orderId", pedido))
	f := leerFicha(t, e, ven, id)
	cuenta := f["cuenta"].(map[string]any)
	if f["modo"] != "pedido" || cuenta["subtotalPlacas"].(float64) != 0 || cuenta["subtotalCanto"].(float64) <= 0 {
		t.Errorf("cotiza las placas del pedido otra vez: %v %v", f["modo"], cuenta)
	}
	faltan, _ := json.Marshal(cuenta["faltan"])
	if !strings.Contains(string(faltan), "El plano usa 1 placa y el pedido PED-1059 vende 3 placas.") {
		t.Errorf("sin aviso de la diferencia: %s", faltan)
	}
	if f["retalesDelCliente"] != true {
		t.Errorf("los retales de placas pagadas van al stock")
	}

	// Vendido en el mostrador con 10 % de descuento: se cobró eso.
	venta := e.pedido(t, "PED-1026",
		map[string]any{"descripcion": "Corte a medida · 3 piezas", "unidad": "pasada", "cantidad": 4, "precio": 1200, "delCorte": true})
	if _, err := e.pool.Exec(context.Background(), `update orders set descuento = 480, total = 4320, estado_pago = 'pagado' where id = $1`, venta); err != nil {
		t.Fatal(err)
	}
	vendido := alta(t, e, ven, melamina(e, "orderId", venta, "piezas", []any{pieza(600, 300, 3)}))
	f = leerFicha(t, e, ven, vendido)
	p := f["pedido"].(map[string]any)
	if f["modo"] != "vendido" || p["cobrado"].(float64) != 4320 || p["estadoPago"] != "pagado" {
		t.Errorf("lo cobrado: %v %v", f["modo"], p)
	}
	if f["cuenta"].(map[string]any)["total"].(float64) != 0 {
		t.Errorf("vuelve a cotizar lo vendido")
	}
}

// H283 y H321: la reposición sale del pedido, sin cargo, y al entregarla
// queda escrita en el pedido.
func TestReposicionSinCargo(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	if code, b := pedir(t, ven, "POST", e.srv.URL+"/api/v1/admin/cortes", melamina(e, "sinCargo", true)); code != 422 || !strings.Contains(b, "sale de un pedido") {
		t.Errorf("reposición suelta: %d %s", code, b)
	}
	pedido := e.pedido(t, "PED-1068", map[string]any{"variante": e.melamina, "descripcion": "Melamina Blanca", "unidad": "placa", "cantidad": 3, "precio": 84500})
	id := alta(t, e, ven, melamina(e, "orderId", pedido, "sinCargo", true, "piezas", []any{pieza(450, 400, 1)}))
	f := leerFicha(t, e, ven, id)
	if f["modo"] != "sinCargo" || f["cuenta"].(map[string]any)["total"].(float64) != 0 {
		t.Errorf("la reposición cobra: %v %v", f["modo"], f["cuenta"])
	}
	u := e.srv.URL + "/api/v1/admin/cortes/" + id
	for _, paso := range []string{"en-cola", "en-proceso", "terminado"} {
		if code, b := pedir(t, ven, "POST", u+"/avanzar?desde="+paso, nil); code != 200 {
			t.Fatalf("%s: %d %s", paso, code, b)
		}
	}
	if n := e.txt(t, `select count(*)::text from order_status_history where order_id = $1 and nota = 'Reposición sin cargo entregada: CRT-1'`, pedido); n != "1" {
		t.Errorf("constancia en el pedido: %s", n)
	}
}

// H122: la cola de un taller.
func TestLaColaPorSucursal(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	aserradero := e.txt(t, `insert into branches (slug, name, sort_order) values ('aserradero', 'Aserradero', 2) returning id::text`)
	alta(t, e, ven, melamina(e, "branchId", aserradero, "contactoNombre", "Quiroga"))
	alta(t, e, ven, melamina(e, "branchId", e.central, "contactoNombre", "Ferreyra"))
	_, b := pedir(t, ven, "GET", e.srv.URL+"/api/v1/admin/cortes?sucursal="+aserradero, nil)
	if !strings.Contains(b, "Quiroga") || strings.Contains(b, "Ferreyra") {
		t.Errorf("la cola del aserradero: %s", b)
	}
}
