package mostrador

import (
	"context"
	"mjbj/internal/formato"
	"net/http"
	"testing"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/jsmath"
	"mjbj/internal/precios"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
)

// Los controles de T3 sobre la venta: el precio de lista lo pone el
// servidor, lo que se deja de cobrar pasado lo libre pide el PIN de un
// admin, el corte acomodado a mano no esquiva la media placa, la clave
// reintentada no se frena en el límite y la anulación tiene dueño.

const pinDeLaDuena = "482915"

// conPIN da de alta a la dueña con su PIN cargado.
func (e *entorno) conPIN(t *testing.T) *http.Client {
	t.Helper()
	adm := e.staff(t, "duena@prueba.test", sqlc.StaffRoleAdmin)
	id := e.txt(t, `select id from "user" where email = 'duena@prueba.test'`)
	rol := sqlc.StaffRoleAdmin
	ses := &auth.Sesion{UserID: id, Nombre: "Persona admin", Correo: "duena@prueba.test", Rol: sqlc.UserRoleStaff, RolStaff: &rol}
	if err := e.ses.CargarPIN(context.Background(), ses, "una clave larga", pinDeLaDuena); err != nil {
		t.Fatal(err)
	}
	return adm
}

func autorizacionDe(t *testing.T, m map[string]any) map[string]any {
	t.Helper()
	a, ok := m["autorizacion"].(map[string]any)
	if !ok {
		t.Fatalf("esperaba que pida el PIN: %v", m)
	}
	return a
}

func TestPrecioBajoLaLista(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.conPIN(t)
	u := e.u + "/api/v1/mostrador/ventas"

	// Dentro del 5 %: 2 placas a 43.000 (lista 45.000,50) son 4001 de 90.001.
	v := e.venta("transferencia", map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "unidad": "placa", "cantidad": 2, "precioUnitario": 43000})
	st, m, b := pedir(t, ven, "POST", u, v)
	if st != 200 || m["ok"] != true {
		t.Fatalf("dentro del 5 %%: %d %s", st, b)
	}
	pedido := m["orderId"].(string)
	if s := e.txt(t, `select dejado_de_cobrar::text || ' ' || (autorizado_por is null)::text from orders where id = $1`, pedido); s != "4001.00 true" {
		t.Errorf("lo dejado de cobrar: %s", s)
	}
	if s := e.txt(t, `select precio_lista::text from order_items where order_id = $1`, pedido); s != "45000.50" {
		t.Errorf("el precio de lista queda en el renglón: %s", s)
	}

	// Por encima: pide el PIN con lo que se deja de cobrar.
	v = e.venta("transferencia", map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "unidad": "placa", "cantidad": 2, "precioUnitario": 40000})
	_, m, _ = pedir(t, ven, "POST", u, v)
	if a := autorizacionDe(t, m); a["motivo"] != "precio" || a["monto"] != 10001.0 || m["ok"] != false {
		t.Fatalf("pasado el 5 %%: %v", m)
	}
	// Un PIN equivocado lo dice y no vende.
	v["pin"] = "000000"
	_, m, _ = pedir(t, ven, "POST", u, v)
	if a := autorizacionDe(t, m); a["pinIncorrecto"] != true || m["error"] != "PIN incorrecto." {
		t.Fatalf("PIN incorrecto: %v", m)
	}
	// Con el PIN de la dueña, vende y queda a su nombre.
	v["pin"] = pinDeLaDuena
	st, m, b = pedir(t, ven, "POST", u, v)
	if st != 200 || m["ok"] != true {
		t.Fatalf("con PIN: %d %s", st, b)
	}
	pedido = m["orderId"].(string)
	if s := e.txt(t, `select o.dejado_de_cobrar::text || ' ' || u.email from orders o join "user" u on u.id = o.autorizado_por where o.id = $1`, pedido); s != "10001.00 duena@prueba.test" {
		t.Errorf("autorizada: %s", s)
	}
	if d := e.txt(t, `select coalesce(detalle, '') from audit_log where entidad_id = $1`, pedido); d != `{"autorizadoPor":"Persona admin","dejadoDeCobrar":10001}` {
		t.Errorf("bitácora: %s", d)
	}
	// El precio que manda el navegador como «lista» no se cree.
	v = e.venta("transferencia", map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "unidad": "placa", "cantidad": 2, "precioUnitario": 40000, "precioLista": 40000})
	_, m, _ = pedir(t, ven, "POST", u, v)
	autorizacionDe(t, m)
}

// La escala automática por medio de pago no cuenta; el descuento tipeado
// sobre el total sí, y la media placa se compara con el precio de la media.
func TestLoQueCuentaParaElPorcentaje(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.conPIN(t)
	u := e.u + "/api/v1/mostrador/ventas"
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta) values ('transferencia', 0, 10, 'Transferencia -10%')`); err != nil {
		t.Fatal(err)
	}
	// El 10 % automático de la transferencia: regla del negocio, sin PIN.
	if st, m, b := pedir(t, ven, "POST", u, e.venta("transferencia", e.lineaPlaca(2))); st != 200 || m["ok"] != true {
		t.Fatalf("escala automática: %d %s", st, b)
	}
	// Un descuento tipeado del 6 % sobre el total, sí.
	v := e.venta("debito", e.lineaPlaca(2))
	v["descuento"] = 5400.06
	_, m, _ := pedir(t, ven, "POST", u, v)
	if a := autorizacionDe(t, m); a["monto"] != 5400.06 {
		t.Fatalf("descuento tipeado: %v", m)
	}

	// La media placa: la lista es la de la media (50 % de 45.000,50 =
	// 22.500, al peso). A ese precio no deja nada; a 18.000, sí.
	media := map[string]any{"variantId": e.placa, "descripcion": "Fenólico — media", "unidad": "placa", "cantidad": 1, "precioUnitario": 22500, "presentacion": "media_largo"}
	st, m, b := pedir(t, ven, "POST", u, e.venta("debito", media))
	if st != 200 || m["ok"] != true {
		t.Fatalf("media placa a precio: %d %s", st, b)
	}
	if s := e.txt(t, `select precio_lista::text from order_items where order_id = $1`, m["orderId"]); s != "22500.00" {
		t.Errorf("lista de la media: %s", s)
	}
	media["precioUnitario"] = 18000
	_, m, _ = pedir(t, ven, "POST", u, e.venta("debito", media))
	if a := autorizacionDe(t, m); a["monto"] != 4500.0 {
		t.Fatalf("media placa bajo la lista: %v", m)
	}
	// Es la misma cuenta que la del buscador (ventas.PrecioDeMedia).
	listas, err := precios.PreciosDeLista(ctx, e.pool, []precios.RenglonConVariante{{VariantID: &e.placa, Presentacion: ptrTexto("media_ancho")}},
		precios.Lista{ID: &e.general, GeneralID: &e.general, FactorDerivado: 1})
	if err != nil || listas[0] == nil || *listas[0] != ventas.PrecioDeMedia(45000.5, 50) {
		t.Fatalf("precio de la media: %v %v", listas, err)
	}

	// Con la regla en 10 %, el descuento del 6 % pasa sin PIN.
	if _, err := e.pool.Exec(ctx, `insert into site_settings (clave, valor) values ('descuento_sin_autorizacion_pct', '10')
		on conflict (clave) do update set valor = '10'`); err != nil {
		t.Fatal(err)
	}
	v["clave"] = clave()
	if st, m, b := pedir(t, ven, "POST", u, v); st != 200 || m["ok"] != true {
		t.Fatalf("con la regla en 10 %%: %d %s", st, b)
	}
}

func ptrTexto(s string) *string { return &s }

// Una venta sin conexión ya pasó: no se rechaza por el precio, pero queda
// marcada.
func TestVentaSinConexionBajoLista(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	venta := e.venta("transferencia", map[string]any{"variantId": e.placa, "descripcion": "Fenólico 18 mm", "unidad": "placa", "cantidad": 1, "precioUnitario": 30000})
	venta["numeroProvisorio"] = "CAJA1-009"
	venta["cobradaAt"] = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	lote := map[string]any{"cuerpo": map[string]any{"ventas": []any{venta}}}
	_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/descarga", lote)
	r0 := m["resultados"].([]any)[0].(map[string]any)
	if r0["estado"] != "sincronizada" {
		t.Fatalf("la venta sin conexión se rechazó: %s", b)
	}
	if s := e.txt(t, `select bajo_lista_sin_autorizar::text || ' ' || dejado_de_cobrar::text from orders where id = $1`, r0["orderId"]); s != "true 15000.50" {
		t.Errorf("marcada: %s", s)
	}
	if n := e.num(t, `select count(*)::float8 from audit_log where descripcion like '%bajo lista sin autorizar ($%15.000,50)%'`); n != 1 {
		t.Errorf("bitácora: %v", n)
	}
}

// El corte acomodado a mano para que ninguna placa pase la mitad no deja de
// cobrar el material.
func TestCorteQueEsquivaLaMediaPlaca(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.conPIN(t)
	corte := func(acomodo *string) map[string]any {
		return map[string]any{
			"variantId": e.placa, "materialDescripcion": "Fenólico 18 mm", "placaLargoMm": 2440, "placaAnchoMm": 1220,
			"mitad": nil, "placas": 2, "pasadas": 4, "acomodoManual": acomodo, "cantoDescripcion": nil,
			"piezas": []any{
				map[string]any{"largoMm": 1100, "anchoMm": 800, "cantidad": 1, "respetaVeta": 0, "cantoLargo": 0, "cantoAncho": 0, "etiqueta": nil, "aclaracion": nil},
				map[string]any{"largoMm": 1100, "anchoMm": 800, "cantidad": 1, "respetaVeta": 0, "cantoLargo": 0, "cantoAncho": 0, "etiqueta": nil, "aclaracion": nil},
			},
		}
	}
	separadas := `[{"indice":0,"unidad":1,"placa":1},{"indice":1,"unidad":1,"placa":2}]`
	// Las pasadas de dos placas sueltas, sin material: lo que armaba la
	// pantalla con el acomodo a mano.
	v := e.venta("transferencia", map[string]any{"variantId": nil, "descripcion": "Corte a medida — 4 pasadas", "unidad": "pasada", "cantidad": 4, "precioUnitario": 800})
	v["corte"] = corte(&separadas)
	// Sin el material, el corte no cierra con su plano: se rechaza (comité
	// final, A2; antes pedía el PIN por la placa que faltaba).
	_, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if m["ok"] != false || m["autorizacion"] != nil || m["error"] != "El corte de Fenólico 18 mm no cierra con su plano. Tocá «Corregir» en el corte y guardalo." {
		t.Fatalf("acomodo que esquiva la media placa: %v", m)
	}
	// Con la placa entera cobrada, pasa.
	v = e.venta("transferencia", e.lineaPlaca(1))
	v["corte"] = corte(&separadas)
	if st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); st != 200 || m["ok"] != true {
		t.Fatalf("con la placa: %d %s", st, b)
	}
}

// La venta a cuenta corriente reintentada después de llegar al límite es la
// misma venta, no «no se puede cargar» (T3, hallazgo 39). Y la misma clave
// con otra venta adentro no devuelve la vieja.
func TestReintentoACuentaCorriente(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	u := e.u + "/api/v1/mostrador/ventas"
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `update customers set limite_credito = 100000 where id = $1`, e.cliente); err != nil {
		t.Fatal(err)
	}
	a := e.venta("cuenta_corriente", e.lineaPlaca(2))
	a["customerId"] = e.cliente
	st, m, b := pedir(t, ven, "POST", u, a)
	if st != 200 || m["ok"] != true || m["nueva"] != true {
		t.Fatalf("a cuenta: %d %s", st, b)
	}
	pedido := m["orderId"]
	// Ya no hay límite: una venta nueva pide el PIN…
	otra := e.venta("cuenta_corriente", e.lineaPlaca(1))
	otra["customerId"] = e.cliente
	_, m, _ = pedir(t, ven, "POST", u, otra)
	if a := autorizacionDe(t, m); a["motivo"] != "credito" {
		t.Fatalf("pasado el límite: %v", m)
	}
	// …y la misma, reintentada, vuelve hecha.
	st, m, b = pedir(t, ven, "POST", u, a)
	if st != 200 || m["ok"] != true || m["nueva"] != false || m["orderId"] != pedido {
		t.Fatalf("reintento: %d %s", st, b)
	}
	// La misma clave con otro monto: 409.
	a["lineas"] = []any{e.lineaPlaca(1)}
	if st, _, b := pedir(t, ven, "POST", u, a); st != http.StatusConflict {
		t.Fatalf("misma clave, otra venta: %d %s", st, b)
	}
	if n := e.num(t, `select count(*)::float8 from orders`); n != 1 {
		t.Errorf("pedidos: %v", n)
	}
	// M2S1-073: lo que se lleva fiado sale con su remito para firmar, sin
	// volver a sacar el stock (y el reintento no hace otro).
	if n := e.num(t, `select count(*)::float8 from deliveries where order_id = $1 and estado = 'preparada' and tipo = 'retiro' and firma_token is not null`, pedido); n != 1 {
		t.Errorf("remitos para firmar de la venta a cuenta: %v", n)
	}
	if n := e.num(t, `select count(*)::float8 from inventory_movements where note like 'Remito %'`); n != 0 {
		t.Errorf("el remito de la venta volvió a sacar stock: %v", n)
	}
}

// Pasarse del límite lo autoriza un admin con su PIN: el «autorizado» que
// mandaba la pantalla ya no alcanza.
func TestLimiteDeCreditoConPIN(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.conPIN(t)
	if _, err := e.pool.Exec(context.Background(), `update customers set limite_credito = 1000 where id = $1`, e.cliente); err != nil {
		t.Fatal(err)
	}
	v := e.venta("cuenta_corriente", e.lineaPlaca(1))
	v["customerId"] = e.cliente
	v["autorizado"] = true
	_, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if a := autorizacionDe(t, m); a["motivo"] != "credito" || a["monto"] != 45000.5 {
		t.Fatalf("el booleano de la pantalla no autoriza: %v", m)
	}
	v["pin"] = pinDeLaDuena
	if st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); st != 200 || m["ok"] != true {
		t.Fatalf("con PIN: %d %s", st, b)
	}
}

// Quién anula sin PIN (T3, hallazgo 8).
func TestQuienAnula(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	otro := e.staff(t, "otro@prueba.test", sqlc.StaffRoleVendedor)
	e.conPIN(t)
	ctx := context.Background()
	e.abrir(t, ven, e.central, 1000)
	vender := func(c *http.Client, medio string) string {
		t.Helper()
		_, m, b := pedir(t, c, "POST", e.u+"/api/v1/mostrador/ventas", e.venta(medio, e.lineaPlaca(1)))
		if m["ok"] != true {
			t.Fatalf("venta: %s", b)
		}
		return m["orderId"].(string)
	}
	anular := func(c *http.Client, pedido string, cuerpo map[string]any) map[string]any {
		t.Helper()
		if cuerpo["motivo"] == nil {
			cuerpo["motivo"] = "Prueba"
		}
		_, m, _ := pedir(t, c, "POST", e.u+"/api/v1/mostrador/ventas/"+pedido+"/anular", cuerpo)
		return m
	}

	// Propia, del turno, recién hecha y por transferencia: sin PIN (la
	// devolución se ve en el banco).
	// Lo que vuelve por el banco se dice con el importe.
	if m := anular(ven, vender(ven, "transferencia"), map[string]any{}); m["ok"] != "Venta anulada. Por afuera se devuelven $\u00a045.000,50." || m["porAfuera"] != 45000.5 {
		t.Fatalf("propia y reciente: %v", m)
	}
	// En efectivo, aunque sea propia y de hace un minuto: PIN. Cobrar, dejar
	// ir al cliente y anular con «Volvió» era el robo clásico, apurado.
	if m := anular(ven, vender(ven, "efectivo"), map[string]any{}); autorizacionDe(t, m)["motivo"] != "anular" {
		t.Fatalf("propia en efectivo: %v", m)
	}
	// A cuenta corriente tampoco: «sin cobrar» borraba la deuda sin PIN.
	aCuenta := e.venta("cuenta_corriente", e.lineaPlaca(1))
	aCuenta["customerId"] = e.cliente
	_, mc, bc := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", aCuenta)
	if mc["ok"] != true {
		t.Fatalf("venta a cuenta: %s", bc)
	}
	if m := anular(ven, mc["orderId"].(string), map[string]any{}); autorizacionDe(t, m)["motivo"] != "anular" {
		t.Fatalf("propia a cuenta: %v", m)
	}
	// Una caja abierta desde ayer no vuelve «del turno» a la venta de ayer.
	deAyer := vender(ven, "transferencia")
	if _, err := e.pool.Exec(ctx, `update cash_sessions set abierta_at = now() - interval '2 days' where estado = 'abierta';
		update orders set created_at = now() - interval '1 day' where id = '`+deAyer+`'`); err != nil {
		t.Fatal(err)
	}
	if m := anular(ven, deAyer, map[string]any{}); m["autorizacion"] == nil {
		t.Fatalf("de ayer con la caja abierta desde antes: %v", m)
	}
	// Las que firmó un admin y las que no, separadas para el dueño.
	if n := e.num(t, `select count(*)::float8 from orders where estado = 'cancelado' and anulacion_autorizada_por is null`); n != 1 {
		t.Errorf("anuladas sin firma: %v", n)
	}
	// De otro vendedor: PIN.
	ajena := vender(otro, "efectivo")
	if m := anular(ven, ajena, map[string]any{}); autorizacionDe(t, m)["motivo"] != "anular" {
		t.Fatalf("ajena: %v", m)
	}
	if m := anular(ven, ajena, map[string]any{"pin": pinDeLaDuena}); m["ok"] != "Venta anulada." {
		t.Fatalf("ajena con PIN: %v", m)
	}
	if s := e.txt(t, `select u.email from orders o join "user" u on u.id = o.anulacion_autorizada_por where o.id = $1`, ajena); s != "duena@prueba.test" {
		t.Errorf("quién autorizó la anulación: %s", s)
	}
	// Propia y cobrada, pero de hace más de cinco minutos: PIN.
	vieja := vender(ven, "efectivo")
	if _, err := e.pool.Exec(ctx, `update orders set created_at = now() - interval '10 minutes' where id = $1`, vieja); err != nil {
		t.Fatal(err)
	}
	if m := anular(ven, vieja, map[string]any{}); m["autorizacion"] == nil {
		t.Fatalf("cobrada hace diez minutos: %v", m)
	}
	// De un turno anterior (ayer): PIN.
	ayer := vender(ven, "transferencia")
	if _, err := e.pool.Exec(ctx, `update orders set created_at = now() - interval '1 day' where id = $1`, ayer); err != nil {
		t.Fatal(err)
	}
	if m := anular(ven, ayer, map[string]any{}); m["autorizacion"] == nil {
		t.Fatalf("de ayer: %v", m)
	}

	// «Se la llevó»: PIN siempre, y el stock no vuelve.
	llevada := vender(ven, "efectivo")
	antes := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central)
	if m := anular(ven, llevada, map[string]any{"volvioLaMercaderia": false}); m["autorizacion"] == nil {
		t.Fatalf("se la llevó sin PIN: %v", m)
	}
	if m := anular(ven, llevada, map[string]any{"volvioLaMercaderia": false, "pin": pinDeLaDuena}); m["ok"] != "Venta anulada." {
		t.Fatalf("se la llevó con PIN: %v", m)
	}
	if q := e.num(t, `select qty::float8 from inventory where variant_id = $1 and branch_id = $2`, e.placa, e.central); q != antes {
		t.Errorf("el stock volvió: %v → %v", antes, q)
	}
	if s := e.txt(t, `select mercaderia_no_volvio::text from orders where id = $1`, llevada); s != "true" {
		t.Errorf("marcada: %s", s)
	}

	// Un admin anula sin PIN.
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	if m := anular(adm, vieja, map[string]any{}); m["ok"] != "Venta anulada." {
		t.Fatalf("admin: %v", m)
	}
	_ = jsmath.Fijo2
}

// Las pasadas y el canto del corte tienen precio de lista: la tarifa de la
// placa (cutting_rates). Puestas a $1, o borradas, ya no salen gratis sin PIN
// (revisión de T3).
func TestPasadasDelCorteConTarifa(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.conPIN(t)
	if _, err := e.pool.Exec(context.Background(), `insert into cutting_rates (material, precio_por_pasada, precio_por_metro_canto, activo)
		values ('Placas', 2500, 900, true)`); err != nil {
		t.Fatal(err)
	}
	// Treinta piezas de 600 × 400 con canto en un largo: dos placas, siete
	// pasadas cobrables y 18 m de tapacanto.
	pieza := map[string]any{"largoMm": 600, "anchoMm": 400, "cantidad": 30, "respetaVeta": 0, "cantoLargo": 1, "cantoAncho": 0, "etiqueta": nil, "aclaracion": nil}
	corte := map[string]any{
		"variantId": e.placa, "materialDescripcion": "Fenólico 18 mm", "placaLargoMm": 2440, "placaAnchoMm": 1220,
		"mitad": nil, "placas": 2, "pasadas": 7, "acomodoManual": nil, "cantoDescripcion": nil, "piezas": []any{pieza},
	}
	pasadas := func(precio float64) map[string]any {
		return map[string]any{"variantId": nil, "descripcion": "Corte a medida — 7 pasadas", "unidad": "pasada", "cantidad": 7, "precioUnitario": precio}
	}
	canto := map[string]any{"variantId": nil, "descripcion": "Tapacanto pegado", "unidad": "m", "cantidad": 18, "precioUnitario": 900}
	vender := func(lineas ...map[string]any) (int, map[string]any, string) {
		v := e.venta("transferencia", lineas...)
		v["corte"] = corte
		return pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	}
	// Con la pasada a $1: lo dejado de cobrar es la tarifa, y pide el PIN.
	_, m, b := vender(e.lineaPlaca(2), pasadas(1), canto)
	if a := autorizacionDe(t, m); a["motivo"] != "precio" || a["monto"] != float64(7*2499) {
		t.Fatalf("pasada a $1: %s", b)
	}
	// Sin el renglón de las pasadas, o sin el canto, el corte no cierra con
	// su plano: se rechaza, no se autoriza (comité final, A2). Es lo que
	// manda la pantalla abierta antes de que el admin cargara la tarifa, y
	// el texto lo dice para que traiga las nuevas (revisión del carril F).
	tarifasNuevas := "Las tarifas de corte cambiaron. Tocá «Corregir» en el corte de Fenólico 18 mm y guardalo."
	_, m, b = vender(e.lineaPlaca(2), canto)
	if m["error"] != tarifasNuevas || m["autorizacion"] != nil {
		t.Fatalf("sin pasadas: %s", b)
	}
	_, m, b = vender(e.lineaPlaca(2), pasadas(2500))
	if m["error"] != tarifasNuevas || m["autorizacion"] != nil {
		t.Fatalf("sin canto: %s", b)
	}
	// Todo a tarifa: pasa, con la tarifa como precio de lista de los renglones.
	st, m, b := vender(e.lineaPlaca(2), pasadas(2500), canto)
	if st != 200 || m["ok"] != true {
		t.Fatalf("a tarifa: %d %s", st, b)
	}
	if s := e.txt(t, `select string_agg(coalesce(precio_lista::text, '-'), ' ' order by orden) from order_items where order_id = $1`, m["orderId"]); s != "45000.50 2500.00 900.00" {
		t.Errorf("precio de lista de los renglones: %s", s)
	}
}

// Sin conexión, la venta a cuenta pasada del límite entra (ya ocurrió) pero
// queda marcada con lo que se cargó: antes no dejaba rastro.
func TestVentaSinConexionPasadaDelLimite(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	if _, err := e.pool.Exec(context.Background(), `update customers set limite_credito = 1000 where id = $1`, e.cliente); err != nil {
		t.Fatal(err)
	}
	venta := e.venta("cuenta_corriente", e.lineaPlaca(1))
	venta["customerId"] = e.cliente
	venta["numeroProvisorio"] = "CAJA1-010"
	venta["cobradaAt"] = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	lote := map[string]any{"cuerpo": map[string]any{"ventas": []any{venta}}}
	_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/descarga", lote)
	r0 := m["resultados"].([]any)[0].(map[string]any)
	if r0["estado"] != "sincronizada" {
		t.Fatalf("se rechazó: %s", b)
	}
	if s := e.txt(t, `select credito_sin_autorizar::text || ' ' || bajo_lista_sin_autorizar::text from orders where id = $1`, r0["orderId"]); s != "45000.50 false" {
		t.Errorf("marcada: %s", s)
	}
	if n := e.num(t, `select count(*)::float8 from audit_log where descripcion like '%a cuenta pasado el límite sin autorizar ($%45.000,50)%'`); n != 1 {
		t.Errorf("bitácora: %v", n)
	}
}

// En línea, el precio y el crédito a la vez piden un PIN con las dos cifras.
func TestPINConPrecioYCredito(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.conPIN(t)
	if _, err := e.pool.Exec(context.Background(), `update customers set limite_credito = 1000 where id = $1`, e.cliente); err != nil {
		t.Fatal(err)
	}
	l := e.lineaPlaca(1)
	l["precioUnitario"] = 30000
	v := e.venta("cuenta_corriente", l)
	v["customerId"] = e.cliente
	_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if a := autorizacionDe(t, m); a["motivo"] != "precio" || a["monto"] != 15000.5 || a["credito"] != float64(30000) {
		t.Fatalf("las dos cifras: %s", b)
	}
}

func TestLaVentaDiceQuienAutorizo(t *testing.T) {
	r := ResultadoVenta{Numero: "PED-1012", Total: 354211.5, DejadoDeCobrar: 118070.5, AutorizadoPor: "Sim Dueña"}
	if d := DescripcionDeLaVenta(r); d != "Venta de mostrador PED-1012 por "+formato.Importe(354211.5)+" · descuento de "+formato.Importe(118070.5)+" · autorizó Sim Dueña con PIN" {
		t.Error(d)
	}
	if d := DescripcionDeLaVenta(ResultadoVenta{Numero: "PED-1", Total: 100}); d != "Venta de mostrador PED-1 por "+formato.Importe(100) {
		t.Error(d)
	}
}
