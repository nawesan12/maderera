package mostrador

import (
	"context"
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
	if n := e.num(t, `select count(*)::float8 from audit_log where descripcion like '%bajo lista sin autorizar ($15000.50)%'`); n != 1 {
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
	_, m, _ := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if a := autorizacionDe(t, m); a["motivo"] != "precio" || a["monto"] != 45000.5 {
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

	// Propia, del turno y recién hecha: sin PIN.
	if m := anular(ven, vender(ven, "efectivo"), map[string]any{}); m["ok"] != "Venta anulada." {
		t.Fatalf("propia y reciente: %v", m)
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
