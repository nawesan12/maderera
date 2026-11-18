package facturacion

import (
	"testing"

	"mjbj/internal/sqlc"
)

// La factura manual de contado sale con su recibo (cobros.EmitirRecibo), su
// cobro en la factura y el efectivo en la caja abierta; con ficha, la compra
// y el pago se cancelan y el saldo queda en cero. A cuenta corriente sigue
// como antes, y sin cliente no se puede.
func TestFacturaManualDeContado(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	url := e.srv.URL + "/api/v1/admin/facturacion/comprobantes"
	var sucursal, caja string
	e.uno(t, `INSERT INTO branches (slug, name, sort_order) VALUES ('central', 'Central', 1) RETURNING id`, &sucursal)
	e.uno(t, `INSERT INTO cash_sessions (branch_id, abierta_por) VALUES ($1, (SELECT id FROM "user" LIMIT 1)) RETURNING id`, &caja, sucursal)

	// Contado en efectivo, consumidor final sin ficha.
	campos := consumidor()
	campos["comoPaga"], campos["medio"] = "contado", "efectivo"
	st, b := pedir(t, admin, "POST", url, manual(campos, [4]string{"Fenólico", "1", "12100", "21"}))
	if st != 200 {
		t.Fatalf("contado: %d %s", st, b)
	}
	id := leerJSON[map[string]string](t, b)["invoiceId"]
	var medio, monto string
	e.uno(t, `SELECT p.medio::text || ' ' || p.monto::text FROM invoice_payments p JOIN receipts r ON r.id = p.receipt_id
		WHERE p.invoice_id = $1`, &medio, id)
	if medio != "efectivo 12100.00" {
		t.Fatalf("cobro de la factura: %q", medio)
	}
	e.uno(t, `SELECT coalesce(sum(monto), 0)::text FROM cash_movements WHERE session_id = $1`, &monto, caja)
	if monto != "12100.00" {
		t.Fatalf("caja: %q", monto)
	}

	// Contado con tarjeta, con ficha nueva: la cuenta queda en cero.
	campos = map[string]string{"receptorNombre": "Gómez SRL", "receptorCuit": "30-71234567-1", "receptorCondicionIva": "responsable_inscripto",
		"guardarComoCliente": "on", "comoPaga": "contado", "medio": "tarjeta_debito"}
	st, b = pedir(t, admin, "POST", url, manual(campos, [4]string{"Fenólico", "1", "12100", "21"}))
	if st != 200 {
		t.Fatalf("contado con ficha: %d %s", st, b)
	}
	id = leerJSON[map[string]string](t, b)["invoiceId"]
	var saldo string
	e.uno(t, `SELECT sum(m.monto)::text || ' ' || count(*)::text FROM account_movements m JOIN invoices i ON i.customer_id = m.customer_id WHERE i.id = $1`, &saldo, id)
	if saldo != "0.00 2" {
		t.Fatalf("cuenta del cliente: %q", saldo)
	}
	e.uno(t, `SELECT medio::text FROM invoice_payments WHERE invoice_id = $1`, &medio, id)
	if medio != "tarjeta" {
		t.Fatalf("medio: %q", medio)
	}

	// Cuenta corriente sin cliente: no hay a quién cargarle la deuda.
	campos = consumidor()
	campos["comoPaga"] = "cuenta_corriente"
	if st, b := pedir(t, admin, "POST", url, manual(campos, [4]string{"Fenólico", "1", "12100", "21"})); st != 422 {
		t.Fatalf("cuenta corriente sin cliente: %d %s", st, b)
	}
	// Un medio que no es de la lista.
	campos = consumidor()
	campos["comoPaga"], campos["medio"] = "contado", "cheque"
	if st, b := pedir(t, admin, "POST", url, manual(campos, [4]string{"Fenólico", "1", "12100", "21"})); st != 422 {
		t.Fatalf("medio inválido: %d %s", st, b)
	}
}
