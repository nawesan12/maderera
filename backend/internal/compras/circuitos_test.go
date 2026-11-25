package compras

import (
	"context"
	"strings"
	"testing"
)

// Un cheque de la cartera se endosa solo en un pago de su circuito (comité
// final, M8): el del B en un pago blanco salía de Valores a depositar del
// estudio, donde nunca había entrado.
func TestElEndosoNoCruzaDeCircuito(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	cheque := func(numero, circuito string) string {
		var id string
		if err := e.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, fecha_pago, importe, estado, circuito)
			values ('recibido', 'fisico', $1, now(), 500, 'cartera', $2) returning id`, numero, circuito).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	pagar := func(circuito, chequeID string) (int, string) {
		return pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 500, "medio": "cheque",
			"circuito": circuito, "retenciones": []any{}, "imputaciones": []any{}, "partes": []any{map[string]any{"medio": "cheque", "importe": 500, "chequeId": chequeID, "cheque": nil}}})
	}
	negro, blanco := cheque("11111111", "negro"), cheque("22222222", "blanco")
	if c, b := pagar("blanco", negro); c != 422 || !strings.Contains(b, "circuito B") {
		t.Errorf("el cheque B en un pago blanco: %d %s", c, b)
	}
	if c, b := pagar("negro", blanco); c != 422 || !strings.Contains(b, "circuito blanco") {
		t.Errorf("el cheque blanco en un pago B: %d %s", c, b)
	}
	if c, b := pagar("negro", negro); c != 200 {
		t.Errorf("el cheque B en un pago B: %d %s", c, b)
	}
	if c, b := pagar("blanco", blanco); c != 200 {
		t.Errorf("el cheque blanco en un pago blanco: %d %s", c, b)
	}
	estado := func(id string) string {
		var s string
		if err := e.pool.QueryRow(ctx, `select estado::text from cheques where id = $1`, id).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	if estado(negro) != "entregado" || estado(blanco) != "entregado" {
		t.Errorf("los endosados del mismo circuito salen de la cartera: %s %s", estado(negro), estado(blanco))
	}

	// Un pago sin circuito es blanco: el cheque B se rechaza y sigue en
	// cartera.
	otroNegro := cheque("33333333", "negro")
	sinCircuito := func(chequeID string) (int, string) {
		return pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 500, "medio": "cheque",
			"retenciones": []any{}, "imputaciones": []any{}, "partes": []any{map[string]any{"medio": "cheque", "importe": 500, "chequeId": chequeID, "cheque": nil}}})
	}
	if c, b := sinCircuito(otroNegro); c != 422 || !strings.Contains(b, "circuito B") || estado(otroNegro) != "cartera" {
		t.Errorf("el cheque B en un pago sin circuito: %d %s (%s)", c, b, estado(otroNegro))
	}

	// El cheque de una venta del mostrador nace «blanco» pero el circuito sale
	// de la factura (fragmentos.CircuitoDelCheque): sin factura con CAE es del
	// B y no se endosa en un pago blanco; con factura, sí.
	delMostrador := func(numero string, conFactura bool) string {
		var pedido, pago, id string
		if err := e.pool.QueryRow(ctx, `insert into orders (numero, contacto_nombre, origen, estado, total) values ($1, 'Mostrador', 'mostrador', 'entregado', 500) returning id`,
			"M-"+numero).Scan(&pedido); err != nil {
			t.Fatal(err)
		}
		if err := e.pool.QueryRow(ctx, `insert into order_payments (order_id, medio, importe) values ($1, 'cheque', 500) returning id`, pedido).Scan(&pago); err != nil {
			t.Fatal(err)
		}
		if conFactura {
			if _, err := e.pool.Exec(ctx, `insert into invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, cae, order_id)
				values ('factura_b', 3, $1::int, 'X', 413.22, 86.78, 0, 0, 0, 500, 'autorizada', now(), '7612', $2)`, numero[:4], pedido); err != nil {
				t.Fatal(err)
			}
		}
		if err := e.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, fecha_pago, importe, estado, circuito, order_payment_id)
			values ('recibido', 'fisico', $1, now(), 500, 'cartera', 'blanco', $2) returning id`, numero, pago).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	ventaB, ventaFacturada := delMostrador("44444444", false), delMostrador("55555555", true)
	if c, b := pagar("blanco", ventaB); c != 422 || !strings.Contains(b, "circuito B") || estado(ventaB) != "cartera" {
		t.Errorf("el cheque de una venta B del mostrador en un pago blanco: %d %s", c, b)
	}
	if c, b := pagar("blanco", ventaFacturada); c != 200 {
		t.Errorf("el cheque de una venta facturada del mostrador en un pago blanco: %d %s", c, b)
	}
	if c, b := pagar("negro", ventaB); c != 200 {
		t.Errorf("el cheque de una venta B del mostrador en un pago B: %d %s", c, b)
	}
}
