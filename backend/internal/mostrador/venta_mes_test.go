package mostrador

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"mjbj/internal/reglas"
	"mjbj/internal/sqlc"
)

// Lo que el mes simulado encontró al cobrar:
//
//   - H018: seis fenólicos a $100 con un costo de $75.000 se cobraban sin
//     decir nada. Ahora piden la firma de un admin, «abajo del costo».
//   - H168: el descuento del 10 % por efectivo se repartía también en el
//     flete cargado a mano.
//   - H025: con el pago partido en medios distintos el descuento no corre
//     desde que se parte, aunque un medio todavía no tenga importe.
func TestCobrosDelMesSimulado(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.central, 1000)

	// Bajo el costo: la placa está a $45.000,50 en la lista y cuesta $50.000.
	if _, err := e.pool.Exec(ctx, `insert into variant_costs (variant_id, cantidad_base, costo_promedio) values ($1, 10, 50000)`, e.placa); err != nil {
		t.Fatal(err)
	}
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", e.venta("debito", e.lineaPlaca(2)))
	a, _ := m["autorizacion"].(map[string]any)
	if st != 200 || m["ok"] != false || a == nil || a["motivo"] != "costo" || a["monto"] != 9999.0 {
		t.Fatalf("bajo el costo sin aviso: %d %s", st, b)
	}
	if _, err := e.pool.Exec(ctx, `delete from variant_costs`); err != nil {
		t.Fatal(err)
	}

	// El 10 % por efectivo no toca el flete a mano.
	if _, err := e.pool.Exec(ctx, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta) values ('efectivo', 0, 10, '10% en efectivo')`); err != nil {
		t.Fatal(err)
	}
	flete := map[string]any{"variantId": nil, "descripcion": "Flete a domicilio", "unidad": "unidad", "cantidad": 1, "precioUnitario": 15000}
	st, m, b = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", e.venta("efectivo", e.lineaPlaca(2), flete))
	if st != 200 || m["ok"] != true {
		t.Fatalf("venta con flete: %d %s", st, b)
	}
	// 2 × 45.000,50 = 90.001 − 10 % = 81.000,90, más el flete entero.
	if m["total"] != 96000.9 {
		t.Errorf("total: %v", m["total"])
	}
	if p := e.num(t, `select precio_unitario::float8 from order_items where order_id = $1 and descripcion = 'Flete a domicilio'`, m["orderId"]); p != 15000 {
		t.Errorf("el flete se guardó a %v", p)
	}

	// Pago partido en dos medios, con el segundo todavía vacío: sin escala.
	v := e.venta("efectivo", e.lineaPlaca(1))
	v["sinEscala"] = true
	st, m, b = pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", v)
	if st != 200 || m["ok"] != true || m["total"] != 45000.5 {
		t.Errorf("partido sin escala: %d %s", st, b)
	}
}

// La regla «el precio de profesional es de contado» vale cuando la lista le
// da al cliente un precio mejor en esa venta (H037), y la venta puede ir «a
// precio de lista» para cobrarse con cheque (H031).
func TestListaDelClienteYCheque(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	cheque := func(cliente string, precio float64, aLista bool) map[string]any {
		l := e.lineaPlaca(1)
		l["precioUnitario"] = precio
		v := e.venta("cheque", l)
		v["customerId"] = cliente
		v["pagos"] = []map[string]any{{"medio": "cheque", "importe": precio, "cheque": map[string]any{"numero": clave()[24:], "banco": "Nación",
			"fechaPago": time.Now().AddDate(0, 0, 5).Format("2006-01-02")}}}
		if aLista {
			v["aLista"] = true
		}
		return v
	}
	u := e.u + "/api/v1/mostrador/ventas"
	// El profesional (40.000 contra 45.000,50 de la general) con cheque: no.
	if _, m, b := pedir(t, ven, "POST", u, cheque(e.mayor, 40000, false)); m["ok"] != false || !strings.Contains(fmt.Sprint(m["error"]), "de contado") {
		t.Fatalf("profesional con cheque: %s", b)
	}
	// A precio de lista, sí.
	if _, m, b := pedir(t, ven, "POST", u, cheque(e.mayor, 45000.5, true)); m["ok"] != true {
		t.Fatalf("a precio de lista: %s", b)
	}
	// Una lista constructora con los mismos precios que la general no
	// restringe el medio.
	constructora := e.txt(t, `insert into price_lists (name, slug) values ('Constructora', 'constructora') returning id::text`)
	cliente := e.txt(t, `insert into customers (nombre, price_list_id) values ('Constructora del Sur', $1) returning id::text`, constructora)
	if _, err := e.pool.Exec(ctx, `insert into price_list_items (price_list_id, variant_id, price) values ($1, $2, 45000.50)`, constructora, e.placa); err != nil {
		t.Fatal(err)
	}
	if _, m, b := pedir(t, ven, "POST", u, cheque(cliente, 45000.5, false)); m["ok"] != true {
		t.Fatalf("constructora con cheque: %s", b)
	}
	// Con la regla contado_por_lista en «siempre», la lista propia es de
	// contado aunque no dé ventaja; a precio de lista, no.
	if err := reglas.Fijar(ctx, e.pool, reglas.ContadoPorLista, "siempre"); err != nil {
		t.Fatal(err)
	}
	if _, m, b := pedir(t, ven, "POST", u, cheque(cliente, 45000.5, false)); m["ok"] != false || !strings.Contains(fmt.Sprint(m["error"]), "de contado") {
		t.Fatalf("siempre, constructora con cheque: %s", b)
	}
	if _, m, b := pedir(t, ven, "POST", u, cheque(cliente, 45000.5, true)); m["ok"] != true {
		t.Fatalf("siempre, a precio de lista: %s", b)
	}
	// Sin lista propia, nada cambia.
	sinLista := cheque(cliente, 45000.5, false)
	sinLista["customerId"] = nil
	if _, m, b := pedir(t, ven, "POST", u, sinLista); m["ok"] != true {
		t.Fatalf("siempre, consumidor final con cheque: %s", b)
	}
}

// La regla descuento_al_flete (H168): con «si», el descuento por forma de
// pago también va sobre el flete cargado a mano, y se ve en su renglón.
func TestElDescuentoAlFleteConLaRegla(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	if _, err := e.pool.Exec(ctx, `insert into payment_discounts (medio, desde_monto, porcentaje, etiqueta) values ('efectivo', 0, 10, '10% en efectivo')`); err != nil {
		t.Fatal(err)
	}
	if err := reglas.Fijar(ctx, e.pool, reglas.DescuentoAlFlete, "si"); err != nil {
		t.Fatal(err)
	}
	e.abrir(t, ven, e.central, 0)
	flete := map[string]any{"variantId": nil, "descripcion": "Flete a domicilio", "unidad": "unidad", "cantidad": 1, "precioUnitario": 15000}
	st, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/ventas", e.venta("efectivo", e.lineaPlaca(2), flete))
	if st != 200 || m["ok"] != true {
		t.Fatalf("venta con flete: %d %s", st, b)
	}
	// (90.001 + 15.000) − 10 % = 94.500,90.
	if m["total"] != 94500.9 {
		t.Errorf("total: %v", m["total"])
	}
	if p := e.num(t, `select precio_unitario::float8 from order_items where order_id = $1 and descripcion = 'Flete a domicilio'`, m["orderId"]); p != 13500 {
		t.Errorf("el flete se guardó a %v", p)
	}
}

// La regla lote_y_cupon (H032): con «obligatorio» (el de arranque) la
// tarjeta en línea no se cobra sin lote y cupón; sin conexión, sí; con
// «opcional», en línea también.
func TestLoteYCupon(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	if err := reglas.Fijar(ctx, e.pool, reglas.LoteYCupon, "obligatorio"); err != nil {
		t.Fatal(err)
	}
	u := e.u + "/api/v1/mostrador/ventas"
	tarjeta := func(lote, cupon string) map[string]any {
		v := e.venta("debito", e.lineaPlaca(1))
		v["pagos"] = []map[string]any{{"medio": "debito", "importe": 45000.5, "nroLote": lote, "nroCupon": cupon, "tarjeta": "Visa", "cuotas": 1}}
		return v
	}
	if _, m, b := pedir(t, ven, "POST", u, e.venta("debito", e.lineaPlaca(1))); m["error"] != "Falta el lote o el cupón de la tarjeta." {
		t.Fatalf("sin datos: %s", b)
	}
	if _, m, b := pedir(t, ven, "POST", u, tarjeta("12", "")); m["error"] != "Falta el lote o el cupón de la tarjeta." {
		t.Fatalf("sin cupón: %s", b)
	}
	if _, m, b := pedir(t, ven, "POST", u, tarjeta("12", "3456")); m["ok"] != true {
		t.Fatalf("con lote y cupón: %s", b)
	}
	// Sin conexión la venta ya pasó: entra igual.
	cola := e.venta("debito", e.lineaPlaca(1))
	cola["numeroProvisorio"] = "CAJA1-011"
	cola["cobradaAt"] = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	_, m, b := pedir(t, ven, "POST", e.u+"/api/v1/mostrador/descarga", map[string]any{"cuerpo": map[string]any{"ventas": []any{cola}}})
	if r0 := m["resultados"].([]any)[0].(map[string]any); r0["estado"] != "sincronizada" {
		t.Fatalf("sin conexión: %s", b)
	}
	// Por transferencia no hace falta nada.
	if _, m, b := pedir(t, ven, "POST", u, e.venta("transferencia", e.lineaPlaca(1))); m["ok"] != true {
		t.Fatalf("transferencia: %s", b)
	}
	if err := reglas.Fijar(ctx, e.pool, reglas.LoteYCupon, "opcional"); err != nil {
		t.Fatal(err)
	}
	if _, m, b := pedir(t, ven, "POST", u, e.venta("debito", e.lineaPlaca(1))); m["ok"] != true {
		t.Fatalf("opcional, sin datos: %s", b)
	}
}
