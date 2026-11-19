package mostrador

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"mjbj/internal/sqlc"
	"mjbj/internal/zodjs"
)

// Lo que encontraron los revisores del carril F sobre los arreglos del
// comité final.

// descargar sube una venta por la cola sin conexión y devuelve su resultado.
func (e *entorno) descargar(t *testing.T, c *http.Client, venta map[string]any, numero string) map[string]any {
	t.Helper()
	venta["numeroProvisorio"] = numero
	venta["cobradaAt"] = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	_, m, b := pedir(t, c, "POST", e.u+"/api/v1/mostrador/descarga", map[string]any{"cuerpo": map[string]any{"ventas": []any{venta}}})
	rs, _ := m["resultados"].([]any)
	if len(rs) != 1 {
		t.Fatalf("descarga: %s", b)
	}
	return rs[0].(map[string]any)
}

// M1, afinado: la cola rechaza solo la cuenta bloqueada. Un cliente sin
// cuenta corriente habilitada (límite 0) también es «no autorizable», y
// rechazarlo dejaba apartada una venta que ya se había entregado: entra
// marcada como crédito sin autorizar.
func TestColaSinCuentaHabilitadaEntraMarcada(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	if _, err := e.pool.Exec(context.Background(), `update customers set limite_credito = 0 where id = $1`, e.cliente); err != nil {
		t.Fatal(err)
	}
	venta := e.venta("cuenta_corriente", e.lineaPlaca(1))
	venta["customerId"] = e.cliente
	r := e.descargar(t, ven, venta, "CAJA1-020")
	if r["estado"] != "sincronizada" {
		t.Fatalf("sin cuenta habilitada se rechazó: %v", r)
	}
	if s := e.txt(t, `select credito_sin_autorizar::text from orders where id = $1`, r["orderId"]); s != "45000.50" {
		t.Errorf("marcada: %s", s)
	}
	// Bloqueada y con límite 0, se rechaza igual.
	if _, err := e.pool.Exec(context.Background(), `update customers set cuenta_bloqueada = true where id = $1`, e.cliente); err != nil {
		t.Fatal(err)
	}
	venta = e.venta("cuenta_corriente", e.lineaPlaca(1))
	venta["customerId"] = e.cliente
	if r := e.descargar(t, ven, venta, "CAJA1-021"); r["estado"] != "rechazada" {
		t.Fatalf("la bloqueada sin límite entró: %v", r)
	}
	// El padrón sin conexión trae la cuenta bloqueada, para que la pantalla
	// no deje elegir cuenta corriente.
	p, err := e.svc.Padron(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range p.Clientes {
		if c.ID == e.cliente && !c.CuentaBloqueada {
			t.Errorf("el padrón no dice que está bloqueada")
		}
	}
}

// La cola salteaba M10 y M14 porque «numeroProvisorio» lo pone el navegador:
// media bisagra o un renglón a $0 entraban sin marca. No se rechaza (ya
// pasó), pero queda marcada para el dueño.
func TestColaConRenglonRaroQuedaMarcada(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	tornillo := map[string]any{"variantId": e.tornillo, "descripcion": "Tornillo 6x40", "unidad": "unidad", "cantidad": 2.5, "precioUnitario": 150}
	r := e.descargar(t, ven, e.venta("transferencia", tornillo), "CAJA1-030")
	if r["estado"] != "sincronizada" {
		t.Fatalf("se rechazó: %v", r)
	}
	if s := e.txt(t, `select bajo_lista_sin_autorizar::text from orders where id = $1`, r["orderId"]); s != "true" {
		t.Errorf("media bisagra sin marca: %s", s)
	}
	tornillo["cantidad"] = 3
	r = e.descargar(t, ven, e.venta("transferencia", tornillo), "CAJA1-031")
	if s := e.txt(t, `select bajo_lista_sin_autorizar::text from orders where id = $1`, r["orderId"]); s != "false" {
		t.Errorf("tres tornillos marcados: %s", s)
	}
}

// corteDePrueba es un despiece sobre la placa del entorno.
func (e *entorno) corteDePrueba(piezas ...map[string]any) map[string]any {
	ps := make([]any, len(piezas))
	for i, p := range piezas {
		ps[i] = p
	}
	return map[string]any{
		"variantId": e.placa, "materialDescripcion": "Fenólico 18 mm", "placaLargoMm": 2440, "placaAnchoMm": 1220,
		"mitad": nil, "placas": 1, "pasadas": 0, "acomodoManual": nil, "cantoDescripcion": nil, "piezas": ps,
	}
}

// renglonesDelCorte son los renglones que cierran con el plano del corte i.
func (e *entorno) renglonesDelCorte(t *testing.T, i int, k map[string]any, precioPasada float64) []map[string]any {
	t.Helper()
	c, _ := e.svc.planoDelCorte(context.Background(), *leerCorte(zodjs.Raiz(aJSON(t, k))))
	var r []map[string]any
	if c.Placas > 0 {
		l := e.lineaPlaca(float64(c.Placas))
		l["corte"] = i
		r = append(r, l)
	}
	if c.Pasadas > 0 && precioPasada > 0 {
		r = append(r, map[string]any{"variantId": nil, "descripcion": "Corte a medida", "unidad": "pasada", "cantidad": c.Pasadas, "precioUnitario": precioPasada, "corte": i})
	}
	return r
}

// El disco lo pone /admin/calculadora, no el navegador: mandar 0,5 mm
// acomodaba más piezas por placa y le daba al taller un disco irreal.
func TestLaSierraDelNavegadorNoSeCree(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	if _, err := e.pool.Exec(context.Background(), `insert into calculator_settings (ancho_sierra_mm) values (4)`); err != nil {
		t.Fatal(err)
	}
	k := e.corteDePrueba(piezaDeCorte(1100, 800, 2))
	k["anchoSierraMm"] = 0.5
	v := e.venta("transferencia", e.renglonesDelCorte(t, 0, k, 0)...)
	v["cortes"] = []any{k}
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["ok"] != true {
		t.Fatalf("venta: %d %s", st, b)
	}
	if s := e.txt(t, `select ancho_sierra_mm::float8::text from cutting_orders where order_id = $1`, m["orderId"]); s != "4" {
		t.Errorf("el taller recibió el disco del navegador: %s", s)
	}
}

// La misma clave con otro despiece no es la misma venta: devolvía la vieja
// como hecha, y el despiece nuevo no llegaba al taller. El corte de tres
// piezas chicas no cobra nada (sin tarifa) y viaja igual, sin llevarse la
// placa suelta del mismo material.
func TestLaHuellaMiraLosCortes(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	k := e.corteDePrueba(piezaDeCorte(400, 300, 3))
	v := e.venta("transferencia", append(e.renglonesDelCorte(t, 0, k, 0), e.lineaPlaca(1))...)
	v["cortes"] = []any{k}
	if st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); st != 200 || m["ok"] != true {
		t.Fatalf("venta: %d %s", st, b)
	}
	v["cortes"] = []any{e.corteDePrueba(piezaDeCorte(400, 350, 3))}
	if st, _, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v); st != 409 || !strings.Contains(b, "ya se cobró como") {
		t.Fatalf("otro despiece con la misma clave: %s", b)
	}
}

// Lo que sale del corte queda marcado en el renglón (migración 00175), y
// «El personal» deja de adivinarlo por la unidad.
func TestElRenglonDelCorteQuedaMarcado(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	k := e.corteDePrueba(piezaDeCorte(1100, 800, 2))
	aMano := map[string]any{"variantId": nil, "descripcion": "Flete", "unidad": "pasada", "cantidad": 1, "precioUnitario": 3000}
	v := e.venta("transferencia", append(e.renglonesDelCorte(t, 0, k, 0), aMano)...)
	v["cortes"] = []any{k}
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["ok"] != true {
		t.Fatalf("venta: %d %s", st, b)
	}
	if s := e.txt(t, `select string_agg(descripcion || ':' || del_corte::text, ',' order by orden) from order_items where order_id = $1`, m["orderId"]); s != "Fenólico 18 mm:true,Flete:false" {
		t.Errorf("marcas: %s", s)
	}
}

// Un corte armado con conexión y cobrado después sin ella llega al taller.
// Si no cierra con su plano (la tarifa cambió mientras tanto), entra
// marcado: ya se cobró y el cliente espera las piezas.
func TestElCorteDeLaColaLlegaAlTaller(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	// Tres piezas chicas: sin tarifa, el corte no cobra nada, y la venta
	// lleva otra cosa.
	k := e.corteDePrueba(piezaDeCorte(400, 300, 3))
	tornillo := map[string]any{"variantId": e.tornillo, "descripcion": "Tornillo 6x40", "unidad": "unidad", "cantidad": 3, "precioUnitario": 150}
	v := e.venta("transferencia", tornillo)
	v["cortes"] = []any{k}
	r := e.descargar(t, ven, v, "CAJA1-040")
	if r["estado"] != "sincronizada" {
		t.Fatalf("se rechazó: %v", r)
	}
	if n := e.num(t, `select count(*)::float8 from cutting_orders where order_id = $1`, r["orderId"]); n != 1 {
		t.Fatalf("trabajos en el taller: %v", n)
	}
	// La tarifa nueva pide pasadas que la venta no trae.
	if _, err := e.pool.Exec(context.Background(), `insert into cutting_rates (material, precio_por_pasada, activo) values ('Placas', 2500, true)`); err != nil {
		t.Fatal(err)
	}
	v = e.venta("transferencia", tornillo)
	v["cortes"] = []any{k}
	r = e.descargar(t, ven, v, "CAJA1-041")
	if r["estado"] != "sincronizada" {
		t.Fatalf("con la tarifa nueva se rechazó: %v", r)
	}
	if s := e.txt(t, `select bajo_lista_sin_autorizar::text from orders where id = $1`, r["orderId"]); s != "true" {
		t.Errorf("sin marca: %s", s)
	}
	if n := e.num(t, `select count(*)::float8 from cutting_orders where order_id = $1`, r["orderId"]); n != 1 {
		t.Errorf("trabajos: %v", n)
	}
}
