package facturacion

import (
	"context"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
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

// Lo aplicado a una factura (una nota de crédito, un cobro desde ella) baja
// la cuenta y esa factura, no también la más vieja: la columna Saldo tiene
// que sumar lo que debe la cuenta. La anulación de un recibo devuelve la
// deuda, no es un cargo nuevo que deje todo «Cobrado» (mes 23, M2S1-013).
func TestSaldoDeFacturasConLoAplicadoAUnaFactura(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	var cliente string
	e.uno(t, `INSERT INTO customers (nombre, cuit, condicion_iva, limite_credito) VALUES ('Jorge', '30712345671', 'responsable_inscripto', 100000000) RETURNING id`, &cliente)
	// La A 0001 manual a cuenta corriente, por 247.383.
	campos := map[string]string{"receptorNombre": "Jorge", "receptorCuit": "30-71234567-1", "receptorCondicionIva": "responsable_inscripto",
		"customerId": cliente, "comoPaga": "cuenta_corriente"}
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(campos, [4]string{"Placas", "1", "247383", "21"}))
	if st != 200 {
		t.Fatalf("manual: %d %s", st, b)
	}
	vieja := leerJSON[map[string]string](t, b)["invoiceId"]
	// La A 0003 de un pedido a cuenta, por 88.700.
	var pedido string
	e.uno(t, `INSERT INTO orders (numero, contacto_nombre, origen, subtotal, total, estado, estado_pago, medio_pago, customer_id)
		VALUES ('PED-1130', 'Jorge', 'mostrador', 88700, 88700, 'entregado', 'pendiente', 'cuenta_corriente', $1) RETURNING id`, &pedido, cliente)
	e.exec(t, `INSERT INTO order_items (order_id, descripcion, unidad, cantidad, precio_unitario, subtotal) VALUES ($1, 'Bisagra', 'unidad', 1, 88700, 88700)`, pedido)
	e.exec(t, `INSERT INTO account_movements (customer_id, tipo, monto, referencia) VALUES ($1, 'compra', 88700, 'PED-1130')`, cliente)
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/pedidos/"+pedido+"/facturar", nil); st != 200 {
		t.Fatalf("facturar: %d %s", st, b)
	}
	var nueva string
	e.uno(t, `SELECT id FROM invoices WHERE order_id = $1`, &nueva, pedido)

	saldo := func(id string) float64 {
		st, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+id, nil)
		if st != 200 {
			t.Fatalf("leer %s: %d %s", id, st, b)
		}
		return leerJSON[Completo](t, b).Saldo
	}
	cuenta := func() float64 {
		var d float64
		e.uno(t, `SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE customer_id = $1`, &d, cliente)
		return d
	}
	cuadra := func(paso string, vieja0, nueva0 float64) {
		t.Helper()
		v, n := saldo(vieja), saldo(nueva)
		if v != vieja0 || n != nueva0 {
			t.Fatalf("%s: la vieja debe %v (esperado %v) y la nueva %v (esperado %v)", paso, v, vieja0, n, nueva0)
		}
		if d := cuenta(); v+n != d {
			t.Fatalf("%s: la columna suma %v y la cuenta debe %v", paso, v+n, d)
		}
	}
	cuadra("al empezar", 247383, 88700)

	// Una bisagra devuelta a la cuenta: nota de crédito por 4.200 sobre la nueva.
	e.exec(t, `UPDATE invoices SET acreditado = 4200 WHERE id = $1`, nueva)
	e.exec(t, `INSERT INTO account_movements (customer_id, tipo, monto, referencia) VALUES ($1, 'nota_credito', -4200, 'NC A 0002')`, cliente)
	cuadra("con la nota de crédito", 247383, 84500)

	// Un cobro de 10.000 desde la nueva.
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+nueva+"/cobros",
		map[string]string{"modo": "recibo", "partes": `[{"medio":"transferencia","importe":"10000"}]`}); st != 200 {
		t.Fatalf("cobro: %d %s", st, b)
	}
	cuadra("con el cobro desde la factura", 247383, 74500)

	// Un pago general de 80.000 cancela primero la vieja.
	pagar := func(importe string) string {
		t.Helper()
		var r string
		err := pgx.BeginFunc(context.Background(), e.pool, func(tx pgx.Tx) error {
			v, err := strconv.ParseFloat(importe, 64)
			if err != nil {
				return err
			}
			rec, err := cobros.EmitirRecibo(context.Background(), tx, cobros.Cobro{CustomerID: &cliente, RecibidoDe: "Jorge", Origen: "panel",
				Partes: []cobros.Parte{{Medio: "retencion", Importe: v}}})
			r = rec.ReceiptID
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	rec := pagar("80000")
	cuadra("con un pago a cuenta", 167383, 74500)
	// Anularlo devuelve la deuda: no deja las dos facturas «Cobrado».
	if err := pgx.BeginFunc(context.Background(), e.pool, func(tx pgx.Tx) error {
		_, _, err := cobros.AnularRecibo(context.Background(), tx, rec, "mal cargado", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	cuadra("con el pago anulado", 247383, 74500)

	// Anular el recibo del cobro desde la factura le devuelve la deuda a ella.
	var delCobro string
	e.uno(t, `SELECT receipt_id FROM invoice_payments WHERE invoice_id = $1 AND receipt_id IS NOT NULL`, &delCobro, nueva)
	if err := pgx.BeginFunc(context.Background(), e.pool, func(tx pgx.Tx) error {
		_, _, err := cobros.AnularRecibo(context.Background(), tx, delCobro, "mal cargado", nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	cuadra("con el cobro anulado", 247383, 84500)
}

// Sin certificado la factura dice que no hay ARCA, y la pantalla no ofrece
// «Autorizar en ARCA», que solo devolvía un error (mes 23).
func TestElComprobanteDiceSiHayArca(t *testing.T) {
	for _, conArca := range []bool{false, true} {
		e := armar(t, conArca)
		admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
		campos := map[string]string{"receptorNombre": "Consumidor final", "receptorCondicionIva": "consumidor_final", "comoPaga": "contado", "medio": "transferencia"}
		st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(campos, [4]string{"Flete", "1", "9000", "21"}))
		if st != 200 {
			t.Fatalf("manual: %d %s", st, b)
		}
		id := leerJSON[map[string]string](t, b)["invoiceId"]
		_, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+id, nil)
		if f := leerJSON[Completo](t, b); f.ConArca != conArca {
			t.Errorf("con ARCA %v: dice %v", conArca, f.ConArca)
		}
	}
}
