package mostrador

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"mjbj/internal/sqlc"
)

// El contrato de las rutas de siempre de la copia local, sacado del TS
// (app/api/mostrador/**, commit fbcf149): las mismas direcciones, los mismos
// códigos, los mismos cuerpos y las mismas cabeceras. Hay PC con un sw.js y
// colas cargadas que hablan así: nada de esto puede cambiar.

func crudo(t *testing.T, c *http.Client, metodo, url, cuerpo string) (int, http.Header, string) {
	t.Helper()
	var r io.Reader
	if cuerpo != "" {
		r = strings.NewReader(cuerpo)
	}
	req, _ := http.NewRequest(metodo, url, r)
	if cuerpo != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, resp.Header, strings.TrimSpace(string(b))
}

func igualJSON(t *testing.T, donde, obtenido, esperado string) {
	t.Helper()
	var a, b any
	if err := json.Unmarshal([]byte(obtenido), &a); err != nil {
		t.Fatalf("%s: no es JSON: %q", donde, obtenido)
	}
	_ = json.Unmarshal([]byte(esperado), &b)
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("%s:\n  Go:  %s\n  TS:  %s", donde, obtenido, esperado)
	}
}

func TestGuardiaDeLaCopiaLocal(t *testing.T) {
	e := armar(t)
	anonimo := &http.Client{}
	dep := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	rutas := [][2]string{
		{"POST", "/api/mostrador/latido"}, {"GET", "/api/mostrador/catalogo"}, {"GET", "/api/mostrador/clientes"},
		{"POST", "/api/mostrador/caja/movimientos"}, {"GET", "/api/mostrador/caja/vincular"}, {"POST", "/api/mostrador/caja/vincular"},
	}
	for _, r := range rutas {
		st, h, b := crudo(t, anonimo, r[0], e.u+r[1], "{}")
		if st != 401 || h.Get("Cache-Control") != "private, no-store" {
			t.Fatalf("%s sin sesión: %d %v", r[1], st, h)
		}
		igualJSON(t, r[1]+" sin sesión", b, `{"error":"sesion","detalle":"Iniciá sesión para seguir."}`)
		st, _, b = crudo(t, dep, r[0], e.u+r[1], "{}")
		if st != 403 {
			t.Fatalf("%s depósito: %d", r[1], st)
		}
		igualJSON(t, r[1]+" depósito", b, `{"error":"rol","detalle":"Este puesto es del mostrador. Entrá con un usuario de ventas."}`)
	}
}

func TestLatidoYVincular(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	ctx := context.Background()
	var caja, secreto string
	if err := e.pool.QueryRow(ctx, `insert into pos_devices (codigo, nombre, branch_id, secreto) values ('CAJA1', 'Mostrador 1', $1, 'secreto-1') returning id, secreto`, e.central).Scan(&caja, &secreto); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into pos_devices (codigo, branch_id, secreto, activo) values ('CAJA9', $1, 'x', false)`, e.central); err != nil {
		t.Fatal(err)
	}
	// Latido sin turno, con cuerpo roto: igual contesta quién es.
	st, h, b := crudo(t, ven, "POST", e.u+"/api/mostrador/latido", "no es json")
	if st != 200 || h.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("latido: %d %s", st, b)
	}
	var l map[string]any
	_ = json.Unmarshal([]byte(b), &l)
	if l["turno"] != nil || l["sesion"].(map[string]any)["staffRole"] != "vendedor" || l["sesion"].(map[string]any)["nombre"] != "Persona vendedor" {
		t.Fatalf("latido: %s", b)
	}
	if _, err := time.Parse("2006-01-02T15:04:05.000Z", l["servidorAt"].(string)); err != nil {
		t.Fatalf("servidorAt no es toISOString: %v", l["servidorAt"])
	}
	// Con caja abierta y la caja física con su secreto: anota los pendientes.
	e.abrir(t, ven, e.central, 0)
	_, _, b = crudo(t, ven, "POST", e.u+"/api/mostrador/latido", `{"branchId":"`+e.central+`","caja":{"id":"`+caja+`","secreto":"`+secreto+`"},"pendientes":3.7}`)
	_ = json.Unmarshal([]byte(b), &l)
	turno, _ := l["turno"].(map[string]any)
	if turno == nil || len(turno) != 2 || !strings.HasSuffix(turno["abiertaAt"].(string), "Z") {
		t.Fatalf("latido con turno: %s", b)
	}
	if p := e.num(t, `select pendientes::float8 from pos_devices where id = $1`, caja); p != 3 {
		t.Fatalf("pendientes: %v", p)
	}
	// Con el secreto equivocado no toca nada.
	crudo(t, ven, "POST", e.u+"/api/mostrador/latido", `{"caja":{"id":"`+caja+`","secreto":"otro"},"pendientes":0}`)
	if p := e.num(t, `select pendientes::float8 from pos_devices where id = $1`, caja); p != 3 {
		t.Fatalf("pendientes con otro secreto: %v", p)
	}

	_, _, b = crudo(t, ven, "GET", e.u+"/api/mostrador/caja/vincular", "")
	igualJSON(t, "vincular sin sucursal", b, `{"cajas":[]}`)
	_, _, b = crudo(t, ven, "GET", e.u+"/api/mostrador/caja/vincular?branchId="+e.central, "")
	var v map[string][]map[string]any
	_ = json.Unmarshal([]byte(b), &v)
	if len(v["cajas"]) != 1 || v["cajas"][0]["codigo"] != "CAJA1" || v["cajas"][0]["nombre"] != "Mostrador 1" || len(v["cajas"][0]) != 4 {
		t.Fatalf("cajas: %s", b)
	}
	_, _, b = crudo(t, ven, "POST", e.u+"/api/mostrador/caja/vincular", `{}`)
	igualJSON(t, "vincular sin caja", b, `{"error":"Elegí una caja."}`)
	_, _, b = crudo(t, ven, "POST", e.u+"/api/mostrador/caja/vincular", `{"cajaId":"no-existe"}`)
	igualJSON(t, "vincular caja que no existe", b, `{"error":"Esa caja no existe o está dada de baja."}`)
	_, _, b = crudo(t, ven, "POST", e.u+"/api/mostrador/caja/vincular", `{"cajaId":"`+caja+`"}`)
	igualJSON(t, "vincular", b, `{"caja":{"id":"`+caja+`","codigo":"CAJA1","secreto":"secreto-1"}}`)
}

func TestMovimientoDiferidoRepetible(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	_, _, b := crudo(t, ven, "POST", e.u+"/api/mostrador/caja/movimientos", `{"clave":"x"}`)
	igualJSON(t, "datos", b, `{"error":"datos","detalle":"El movimiento llegó incompleto."}`)
	mov := `{"clave":"8f2b5c1e-1d2a-4c3b-9a8e-0000000000aa","branchId":"` + e.central + `","tipo":"retiro","monto":300,"motivo":" Flete ","hechoAt":"` + time.Now().UTC().Add(-time.Minute).Format(time.RFC3339) + `"}`
	_, _, b = crudo(t, ven, "POST", e.u+"/api/mostrador/caja/movimientos", mov)
	igualJSON(t, "sin turno", b, `{"error":"sin_turno","detalle":"No había ninguna caja abierta en ese momento."}`)

	// El turno se abrió antes del movimiento: el movimiento cae ahí, y con la
	// misma clave veinte veces queda uno solo.
	if _, err := e.pool.Exec(context.Background(), `insert into cash_sessions (branch_id, abierta_por, abierta_at) values ($1, (select id from "user" limit 1), now() - interval '1 hour')`, e.central); err != nil {
		t.Fatal(err)
	}
	sesion := e.txt(t, `select id::text from cash_sessions`)
	nuevos := make(chan bool, 20)
	for i := 0; i < 20; i++ {
		go func() {
			_, _, b := crudo(t, ven, "POST", e.u+"/api/mostrador/caja/movimientos", mov)
			var m map[string]any
			_ = json.Unmarshal([]byte(b), &m)
			if m["ok"] != true || m["sessionId"] != sesion {
				t.Errorf("movimiento: %s", b)
			}
			nuevos <- m["nuevo"] == true
		}()
	}
	n := 0
	for i := 0; i < 20; i++ {
		if <-nuevos {
			n++
		}
	}
	if n != 1 || e.num(t, `select count(*)::float8 from cash_movements`) != 1 || e.num(t, `select monto::float8 from cash_movements`) != -300 {
		t.Fatalf("movimientos nuevos: %d", n)
	}
	if e.txt(t, `select motivo from cash_movements`) != "Flete" {
		t.Fatal("el motivo no se recortó")
	}
}

func TestCopiaLocalYDelta(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	_, _, b := crudo(t, ven, "GET", e.u+"/api/mostrador/catalogo", "")
	var c CopiaDelMostrador
	if err := json.Unmarshal([]byte(b), &c); err != nil {
		t.Fatal(err)
	}
	if len(c.Variantes) != 2 || len(c.Precios) != 3 || len(c.Stock) != 2 || len(c.Listas) != 2 || len(c.Bajas) != 0 {
		t.Fatalf("copia: %s", b)
	}
	sort.Slice(c.Variantes, func(i, j int) bool { return c.Variantes[i].Sku < c.Variantes[j].Sku })
	if c.Variantes[0].Busqueda != "fenolico 18 mm fen18 faplac placas" || c.Variantes[0].PrecioMediaPct != 50 {
		t.Fatalf("variante: %+v", c.Variantes[0])
	}
	// Los nombres de los campos, uno por uno, como los guarda IndexedDB.
	var crudoCopia map[string][]map[string]any
	_ = json.Unmarshal([]byte(b), &crudoCopia)
	claves := func(m map[string]any) string {
		var ks []string
		for k := range m {
			ks = append(ks, k)
		}
		sort.Strings(ks)
		return strings.Join(ks, ",")
	}
	if k := claves(crudoCopia["variantes"][0]); k != "anchoMm,busqueda,categoria,formaDeVenta,largoMm,marca,medida,precioMediaPct,producto,sku,sortOrder,unidad,variantId" {
		t.Fatalf("campos de la variante: %s", k)
	}
	if k := claves(crudoCopia["precios"][0]); k != "precio,priceListId,variantId" {
		t.Fatalf("campos del precio: %s", k)
	}
	if k := claves(crudoCopia["stock"][0]); k != "branchId,qty,variantId" {
		t.Fatalf("campos del stock: %s", k)
	}
	if k := claves(crudoCopia["listas"][0]); k != "esGeneral,id,nombre" {
		t.Fatalf("campos de la lista: %s", k)
	}
	// Un delta: solo lo que cambió, y las bajas. (generadoAt va cinco segundos
	// atrás a propósito; acá se pide desde ahora para no esperarlos.)
	desde := FechaJS(time.Now())
	time.Sleep(10 * time.Millisecond)
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `update product_variants set active = false, updated_at = now() + interval '10 seconds' where id = $1`, e.tornillo); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `update inventory set qty = 7, updated_at = now() + interval '10 seconds' where variant_id = $1`, e.placa); err != nil {
		t.Fatal(err)
	}
	_, _, b = crudo(t, ven, "GET", e.u+"/api/mostrador/catalogo?desde="+desde, "")
	var d CopiaDelMostrador
	_ = json.Unmarshal([]byte(b), &d)
	if len(d.Variantes) != 0 || len(d.Bajas) != 1 || d.Bajas[0] != e.tornillo || len(d.Stock) != 1 || d.Stock[0].Qty != 7 || len(d.Precios) != 0 {
		t.Fatalf("delta: %s", b)
	}
	// Un desde que no es fecha es pedir todo.
	_, _, b = crudo(t, ven, "GET", e.u+"/api/mostrador/catalogo?desde=ayer", "")
	_ = json.Unmarshal([]byte(b), &d)
	if len(d.Variantes) != 1 || len(d.Stock) != 2 {
		t.Fatalf("desde inválido: %s", b)
	}

	_, _, b = crudo(t, ven, "GET", e.u+"/api/mostrador/clientes", "")
	var p map[string]any
	_ = json.Unmarshal([]byte(b), &p)
	cs := p["clientes"].([]any)
	if len(cs) != 2 {
		t.Fatalf("padrón: %s", b)
	}
	ana := cs[0].(map[string]any)
	if ana["nombre"] != "Ana Gómez" || ana["busqueda"] != "ana gomez 20123456786" || ana["limiteCredito"] != 1000000.0 ||
		claves(ana) != "busqueda,condicionIva,cuit,estado,id,limiteCredito,nombre,priceListId,razonSocial" {
		t.Fatalf("cliente: %v", ana)
	}
}

// La descarga de la cola: en orden, idempotente por clave, con la venta
// diferida en el turno que la contenía y el comprobante pendiente con las
// líneas ya rebajadas.
func TestDescargaDeLaCola(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	ctx := context.Background()
	st, _, b := crudo(t, ven, "POST", e.u+"/api/v1/mostrador/descarga", `{"cuerpo":null}`)
	if st != 400 {
		t.Fatalf("cuerpo nulo: %d %s", st, b)
	}
	igualJSON(t, "cuerpo nulo", b, `{"error":"cuerpo","detalle":"Invalid input: expected object, received null"}`)
	st, _, b = crudo(t, ven, "POST", e.u+"/api/v1/mostrador/descarga", `{"cuerpo":{"ventas":[]}}`)
	igualJSON(t, "lote vacío", b, `{"error":"cuerpo","detalle":"Too small: expected array to have >=1 items"}`)

	// Un turno que abrió hace dos horas y cerró hace una: la venta de hace
	// noventa minutos cae ahí, aunque llegue ahora.
	if _, err := e.pool.Exec(ctx, `insert into cash_sessions (branch_id, abierta_por, abierta_at, cerrada_at, estado) values ($1, (select id from "user" limit 1), now() - interval '2 hours', now() - interval '1 hour', 'cerrada')`, e.central); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta) values ('efectivo', 0, 10, 'Contado')`); err != nil {
		t.Fatal(err)
	}
	cobrada := time.Now().UTC().Add(-90 * time.Minute).Format("2006-01-02T15:04:05.000Z")
	diferida := e.venta("efectivo", e.lineaPlaca(1))
	diferida["numeroProvisorio"] = "CAJA1-017"
	diferida["cobradaAt"] = cobrada
	diferida["comprobante"] = "fiscal"
	// Quien vendió ya no existe: la venta entra a nombre de quien la sube
	// (con el TS quedaba en «reintentar» para siempre).
	diferida["usuarioId"] = "otra-persona"
	aCuenta := e.venta("cuenta_corriente", e.lineaPlaca(1))
	aCuenta["numeroProvisorio"] = "CAJA1-018"
	aCuenta["cobradaAt"] = cobrada
	lote := map[string]any{"cuerpo": map[string]any{"ventas": []any{diferida, aCuenta}}}
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/descarga", lote)
	if st != 200 {
		t.Fatalf("descarga: %d %s", st, b)
	}
	rs := m["resultados"].([]any)
	r0, r1 := rs[0].(map[string]any), rs[1].(map[string]any)
	if r0["estado"] != "sincronizada" || r0["numero"] != "PED-1000" || r0["nueva"] != true {
		t.Fatalf("diferida: %v", r0)
	}
	if r1["estado"] != "rechazada" || r1["motivo"] != "Para cargar a cuenta corriente hace falta elegir el cliente." {
		t.Fatalf("a cuenta sin cliente: %v", r1)
	}
	fiscal := r0["fiscal"].(map[string]any)
	if fiscal["lineas"].([]any)[0].(map[string]any)["precioUnitario"] != 40500.45 || fiscal["receptorNombre"] != "Consumidor final" {
		t.Fatalf("comprobante pendiente: %v", fiscal)
	}
	pedido := r0["orderId"].(string)
	if s := e.txt(t, `select numero_provisorio || ' ' || (created_by_user_id = (select id from "user" limit 1))::text || ' ' || (sincronizada_at is not null)::text || ' ' || (abs(extract(epoch from created_at - cobrada_at)) < 1)::text from orders where id = $1`, pedido); s != "CAJA1-017 true true true" {
		t.Fatalf("pedido diferido: %q", s)
	}
	if n := e.num(t, `select count(*)::float8 from cash_movements m join cash_sessions s on s.id = m.session_id where s.estado = 'cerrada' and m.order_id = $1`, pedido); n != 1 {
		t.Fatalf("la venta diferida no cayó en su turno: %v", n)
	}
	// Reenviar el mismo lote: la misma venta, sin comprobante pendiente.
	_, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/descarga", lote)
	r0 = m["resultados"].([]any)[0].(map[string]any)
	if r0["orderId"] != pedido || r0["nueva"] != false || r0["fiscal"] != nil {
		t.Fatalf("reenvío: %v", r0)
	}
	if n := e.num(t, `select count(*)::float8 from orders`); n != 1 {
		t.Fatalf("pedidos: %v", n)
	}
	// Sin turno que la contenga, la diferida en efectivo entra igual, sin caja.
	sinTurno := e.venta("efectivo", e.lineaPlaca(1))
	sinTurno["numeroProvisorio"] = "CAJA1-019"
	sinTurno["cobradaAt"] = time.Now().UTC().Add(-30 * time.Minute).Format(time.RFC3339)
	_, m, _ = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/descarga", map[string]any{"cuerpo": map[string]any{"ventas": []any{sinTurno}}})
	r0 = m["resultados"].([]any)[0].(map[string]any)
	if r0["estado"] != "sincronizada" || e.num(t, `select count(*)::float8 from cash_movements where order_id = $1`, r0["orderId"]) != 0 {
		t.Fatalf("sin turno: %v", r0)
	}
}

// La misma clave subida veinte veces a la vez desde la cola: una venta.
func TestDescargaConcurrenteMismaClave(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	v := e.venta("transferencia", e.lineaPlaca(1))
	v["numeroProvisorio"] = "CAJA2-001"
	v["cobradaAt"] = time.Now().UTC().Format(time.RFC3339)
	lote := map[string]any{"cuerpo": map[string]any{"ventas": []any{v}}}
	hechas := make(chan string, 20)
	for i := 0; i < 20; i++ {
		go func() {
			_, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/descarga", lote)
			r := m["resultados"].([]any)[0].(map[string]any)
			hechas <- r["estado"].(string) + " " + r["orderId"].(string)
		}()
	}
	primera := ""
	for i := 0; i < 20; i++ {
		h := <-hechas
		if primera == "" {
			primera = h
		}
		if h != primera || !strings.HasPrefix(h, "sincronizada ") {
			t.Fatalf("resultados distintos: %q %q", primera, h)
		}
	}
	if n := e.num(t, `select count(*)::float8 from orders`); n != 1 {
		t.Fatalf("pedidos: %v", n)
	}
	if q := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); q != 99 {
		t.Fatalf("stock: %v", q)
	}
}
