package mostrador

import (
	"context"
	"encoding/json"
	"testing"

	"mjbj/internal/sqlc"
	"mjbj/internal/zodjs"
)

// aJSON pasa el mapa por JSON, como llega del navegador (los enteros, en
// float64).
func aJSON(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var x any
	if err := json.Unmarshal(b, &x); err != nil {
		t.Fatal(err)
	}
	return x
}

// Lo que encontró el comité final en la venta del mostrador.

// piezaDeCorte es una pieza del despiece, como la manda la pantalla.
func piezaDeCorte(largo, ancho, cantidad int) map[string]any {
	return map[string]any{"largoMm": largo, "anchoMm": ancho, "cantidad": cantidad, "respetaVeta": 0, "cantoLargo": 0, "cantoAncho": 0, "etiqueta": nil, "aclaracion": nil}
}

// A2: reabrir el corte para corregirlo sumaba los renglones nuevos a los
// viejos —dos placas y dos cortes cobrados sin PIN— y al taller llegaba un
// solo despiece. Ahora cada corte va con sus renglones atados, lo cobrado de
// cada uno tiene que ser lo de su plano (ni de más ni de menos), y una venta
// con dos cortes manda los dos al taller.
func TestVariosCortesEnUnaVenta(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	if _, err := e.pool.Exec(context.Background(), `insert into cutting_rates (material, precio_por_pasada, activo) values ('Placas', 2500, true)`); err != nil {
		t.Fatal(err)
	}
	// Se cobra lo que diga el plano de cada despiece: dos piezas grandes
	// llevan placa, tres chicas solo el corte.
	corte := func(piezas ...map[string]any) map[string]any {
		ps := make([]any, len(piezas))
		for i, p := range piezas {
			ps[i] = p
		}
		return map[string]any{
			"variantId": e.placa, "materialDescripcion": "Fenólico 18 mm", "placaLargoMm": 2440, "placaAnchoMm": 1220,
			"mitad": nil, "placas": 1, "pasadas": 0, "acomodoManual": nil, "cantoDescripcion": nil, "piezas": ps,
		}
	}
	// Lo que cobra el plano de cada corte, para armar renglones que cierran.
	cobroDe := func(k map[string]any) (float64, float64) {
		c, _ := e.svc.planoDelCorte(context.Background(), *leerCorte(zodjs.Raiz(aJSON(t, k))))
		return float64(c.Placas), float64(c.Pasadas)
	}
	grande, chico := corte(piezaDeCorte(1100, 800, 2)), corte(piezaDeCorte(400, 300, 3))
	pg, sg := cobroDe(grande)
	pc, sc := cobroDe(chico)
	if pg == 0 || sc == 0 {
		t.Fatalf("el plano de prueba no cobra placa o pasadas: %v %v %v %v", pg, sg, pc, sc)
	}
	renglones := func(i int, placas, pasadas float64) []map[string]any {
		var r []map[string]any
		if placas > 0 {
			l := e.lineaPlaca(placas)
			l["corte"] = i
			r = append(r, l)
		}
		if pasadas > 0 {
			r = append(r, map[string]any{"variantId": nil, "descripcion": "Corte a medida", "unidad": "pasada", "cantidad": pasadas, "precioUnitario": 2500, "corte": i})
		}
		return r
	}
	u := e.u + "/api/v1/mostrador/ventas"

	// Dos cortes, cada uno con lo suyo: pasa y nacen dos trabajos.
	lineas := append(renglones(0, pg, sg), renglones(1, pc, sc)...)
	v := e.venta("transferencia", lineas...)
	v["cortes"] = []any{grande, chico}
	st, m, b := pedir(t, ven, "POST", u, v)
	if st != 200 || m["ok"] != true {
		t.Fatalf("dos cortes: %d %s", st, b)
	}
	if n := e.num(t, `select count(*)::float8 from cutting_orders where order_id = $1`, m["orderId"]); n != 2 {
		t.Fatalf("trabajos en el taller: %v", n)
	}
	if n := e.num(t, `select count(*)::float8 from cutting_items ci join cutting_orders co on co.id = ci.cutting_order_id where co.order_id = $1`, m["orderId"]); n != 2 {
		t.Errorf("despieces: %v", n)
	}

	// El corte corregido con los renglones viejos todavía en la venta: lo
	// cobrado pasa lo del plano y se rechaza.
	noCierra := "El corte de Fenólico 18 mm no cierra con su plano. Tocá «Corregir» en el corte y guardalo."
	doble := append(renglones(0, pg, sg), renglones(0, pg, sg)...)
	v = e.venta("transferencia", doble...)
	v["cortes"] = []any{grande}
	if _, m, b := pedir(t, ven, "POST", u, v); m["error"] != noCierra {
		t.Fatalf("cobrado dos veces: %s", b)
	}
	// La forma de antes (un «corte» y renglones sin atar) también.
	for _, l := range doble {
		delete(l, "corte")
	}
	v = e.venta("transferencia", doble...)
	v["corte"] = grande
	if _, m, b := pedir(t, ven, "POST", u, v); m["error"] != noCierra {
		t.Fatalf("cobrado dos veces, sin atar: %s", b)
	}
	// Un renglón atado a un corte que no está.
	v = e.venta("transferencia", renglones(3, pg, sg)...)
	v["cortes"] = []any{grande}
	if _, m, b := pedir(t, ven, "POST", u, v); m["ok"] != false || m["error"] == nil {
		t.Fatalf("corte que no está: %s", b)
	}
	// Una placa más del mismo material, suelta (sin atar): no es del corte
	// y no lo descuadra.
	lineas = append(renglones(0, pg, sg), e.lineaPlaca(1))
	v = e.venta("transferencia", lineas...)
	v["cortes"] = []any{grande}
	if st, m, b := pedir(t, ven, "POST", u, v); st != 200 || m["ok"] != true {
		t.Fatalf("placa suelta además del corte: %d %s", st, b)
	}
}

// M10: media bisagra se cobraba y se descontaba del stock. Lo que se vende
// por unidad va entero; la placa admite la media.
func TestFraccionDeLoQueSeVendePorUnidad(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	u := e.u + "/api/v1/mostrador/ventas"
	tornillo := map[string]any{"variantId": e.tornillo, "descripcion": "Tornillo 6x40", "unidad": "metro_lineal", "cantidad": 2.5, "precioUnitario": 150}
	_, m, b := pedir(t, ven, "POST", u, e.venta("transferencia", tornillo))
	if m["error"] != `"Tornillo 6x40" se vende por unidad: la cantidad va sin decimales.` {
		t.Fatalf("fracción de tornillo: %s", b)
	}
	tornillo["cantidad"] = 3
	if st, m, b := pedir(t, ven, "POST", u, e.venta("transferencia", tornillo)); st != 200 || m["ok"] != true {
		t.Fatalf("tres tornillos: %d %s", st, b)
	}
	if st, m, b := pedir(t, ven, "POST", u, e.venta("transferencia", e.lineaPlaca(1.5))); st != 200 || m["ok"] != true {
		t.Fatalf("placa y media: %d %s", st, b)
	}
}

// M14 y decisión 4: no hay productos a $0. Un renglón sin precio dice que
// falta el precio, y no «el descuento no puede llevarse toda la venta».
func TestRenglonSinPrecio(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	u := e.u + "/api/v1/mostrador/ventas"
	l := e.lineaPlaca(1)
	l["precioUnitario"] = 0
	if _, m, b := pedir(t, ven, "POST", u, e.venta("transferencia", l)); m["error"] != `Falta poner el precio de "Fenólico 18 mm".` {
		t.Fatalf("placa a $0: %s", b)
	}
	// Con otro renglón con precio, tampoco.
	if _, m, b := pedir(t, ven, "POST", u, e.venta("transferencia", l, e.lineaPlaca(1))); m["ok"] != false {
		t.Fatalf("placa a $0 con otra: %s", b)
	}
	// Un descuento que se lleva todo sigue diciendo eso.
	v := e.venta("transferencia", e.lineaPlaca(1))
	v["descuento"] = 45000.5
	if _, m, b := pedir(t, ven, "POST", u, v); m["error"] != "El descuento no puede llevarse toda la venta." {
		t.Fatalf("descuento total: %s", b)
	}
}
