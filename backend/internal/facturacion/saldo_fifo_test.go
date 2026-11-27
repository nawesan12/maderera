package facturacion

import (
	"testing"

	"mjbj/internal/sqlc"
)

// Las facturas a cuenta de un mismo cliente se reparten lo que debe la
// cuenta: los recibos cancelan primero la más vieja (mes simulado,
// M2S1-013 y M2S1-052). Antes cada una mostraba el saldo entero de la cuenta
// y la columna sumaba el doble. Lo acreditado con una nota de crédito ya no
// se debe (M3S2-002), y la factura manual emitida a cuenta corriente se lee
// como en la cuenta (M3S4-008).
func TestSaldoDeFacturasACuentaPorAntiguedad(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	var cliente string
	e.uno(t, `INSERT INTO customers (nombre, cuit, condicion_iva, limite_credito) VALUES ('Constructora', '30712345671', 'responsable_inscripto', 100000000) RETURNING id`, &cliente)
	pedido := func(numero string, total float64, hace string) string {
		var id string
		e.uno(t, `INSERT INTO orders (numero, contacto_nombre, origen, subtotal, total, estado, estado_pago, medio_pago, customer_id)
			VALUES ($1, 'Ana', 'mostrador', $2, $2, 'entregado', 'pendiente', 'cuenta_corriente', $3) RETURNING id`, &id, numero, total, cliente)
		e.exec(t, `INSERT INTO order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal) VALUES ($1, 'Placa', 'unidad', 1, $2, $2)`, id, total)
		e.exec(t, `INSERT INTO account_movements (customer_id, tipo, monto, referencia, created_at) VALUES ($1, 'compra', $2, $3, now() - $4::interval)`,
			cliente, total, numero, hace)
		if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+id+"/facturar", nil); st != 200 {
			t.Fatalf("facturar %s: %d %s", numero, st, b)
		}
		return id
	}
	viejo := pedido("PED-1004", 836000, "10 days")
	nuevo := pedido("PED-1019", 1610400, "1 day")
	// Pagó 2.125.000: debe 321.400, que son de la factura nueva.
	e.exec(t, `INSERT INTO account_movements (customer_id, tipo, monto, referencia) VALUES ($1, 'pago', -2125000, 'REC-0001')`, cliente)

	facturaDe := func(pedido string) string {
		var id string
		e.uno(t, `SELECT id FROM invoices WHERE order_id = $1`, &id, pedido)
		return id
	}
	saldo := func(id string) float64 {
		st, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+id, nil)
		if st != 200 {
			t.Fatalf("leer %s: %d %s", id, st, b)
		}
		return leerJSON[Completo](t, b).Saldo
	}
	if s := saldo(facturaDe(viejo)); s != 0 {
		t.Fatalf("la vieja tendría que estar cobrada: %v", s)
	}
	if s := saldo(facturaDe(nuevo)); s != 321400 {
		t.Fatalf("la nueva debe lo de la cuenta: %v", s)
	}
	_, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/pagina", nil)
	suma := 0.0
	for _, f := range leerJSON[PaginaDeComprobantes](t, b).Filas {
		suma += f.Total - f.Cobrado
	}
	if suma != 321400 {
		t.Fatalf("la columna suma %v y la cuenta debe 321.400", suma)
	}
	// Las de la ficha que todavía deben: lo que propone la carga de una
	// retención sufrida (M2S1-113).
	_, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/pagina?conSaldo=true&cliente="+cliente, nil)
	if p := leerJSON[PaginaDeComprobantes](t, b); p.Total != 1 || p.Filas[0].Pedido == nil || *p.Filas[0].Pedido != "PED-1019" {
		t.Fatalf("con saldo: %s", b)
	}

	// Una devolución a la cuenta por 25.650 sobre la nueva: la factura debe
	// lo que queda de ella, no su total.
	e.exec(t, `UPDATE invoices SET acreditado = 25650 WHERE id = $1`, facturaDe(nuevo))
	e.exec(t, `INSERT INTO account_movements (customer_id, tipo, monto, referencia) VALUES ($1, 'nota_credito', -25650, 'NC')`, cliente)
	e.exec(t, `INSERT INTO account_movements (customer_id, tipo, monto, referencia) VALUES ($1, 'ajuste', 2000000, 'saldo viejo')`, cliente)
	// La cuenta debe ahora 2.295.750: lo último cargado es el ajuste, la
	// factura nueva debe su total menos lo acreditado, y a la vieja le
	// quedan 295.750 − 1.584.750 < 0: nada.
	if s := saldo(facturaDe(nuevo)); s != 295750 {
		t.Fatalf("después del ajuste la nueva debe lo que deja el cargo posterior: %v", s)
	}
	// La manual a cuenta corriente está en la cuenta: no ofrece pasarla.
	campos := map[string]string{"receptorNombre": "Constructora", "receptorCuit": "30-71234567-1", "receptorCondicionIva": "responsable_inscripto",
		"customerId": cliente, "comoPaga": "cuenta_corriente"}
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(campos, [4]string{"Flete", "1", "9000", "21"}))
	if st != 200 {
		t.Fatalf("manual a cuenta: %d %s", st, b)
	}
	id := leerJSON[map[string]string](t, b)["invoiceId"]
	_, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+id, nil)
	if f := leerJSON[Completo](t, b); !f.EnCuenta || f.Saldo != 9000 {
		t.Fatalf("la manual a cuenta: en cuenta %v, saldo %v", f.EnCuenta, f.Saldo)
	}
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/cobros",
		map[string]string{"modo": "cuenta_corriente", "monto": "9000"}); st != 422 {
		t.Fatalf("pasarla a cuenta otra vez: %d %s", st, b)
	}
}
