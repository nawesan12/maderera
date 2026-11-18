package facturacion

import (
	"strings"
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

// Con dos cajas abiertas, la factura manual de contado en efectivo no sabía a
// cuál entrar y el aviso se perdía: ahora el formulario manda la sucursal, y
// sin ella la respuesta trae el aviso.
func TestFacturaManualDeContadoConDosCajas(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	url := e.srv.URL + "/api/v1/admin/facturacion/comprobantes"
	var central, norte, cajaCentral, cajaNorte string
	e.uno(t, `INSERT INTO branches (slug, name, sort_order) VALUES ('central', 'Central', 1) RETURNING id`, &central)
	e.uno(t, `INSERT INTO branches (slug, name, sort_order) VALUES ('norte', 'Norte', 2) RETURNING id`, &norte)
	e.uno(t, `INSERT INTO cash_sessions (branch_id, abierta_por) VALUES ($1, (SELECT id FROM "user" LIMIT 1)) RETURNING id`, &cajaCentral, central)
	e.uno(t, `INSERT INTO cash_sessions (branch_id, abierta_por) VALUES ($1, (SELECT id FROM "user" LIMIT 1)) RETURNING id`, &cajaNorte, norte)
	enCaja := func(caja string) string {
		var m string
		e.uno(t, `SELECT coalesce(sum(monto), 0)::text FROM cash_movements WHERE session_id = $1`, &m, caja)
		return m
	}

	// Sin elegir: sale igual, con el aviso, y no entra a ninguna.
	campos := consumidor()
	campos["comoPaga"], campos["medio"] = "contado", "efectivo"
	st, b := pedir(t, admin, "POST", url, manual(campos, [4]string{"Fenólico", "1", "12100", "21"}))
	if st != 200 {
		t.Fatalf("sin caja: %d %s", st, b)
	}
	if r := leerJSON[map[string]string](t, b); !strings.Contains(r["aviso"], "varias cajas abiertas") {
		t.Fatalf("sin aviso: %s", b)
	}
	if enCaja(cajaCentral) != "0" || enCaja(cajaNorte) != "0" {
		t.Fatal("el efectivo entró a una caja que nadie eligió")
	}

	// Eligiendo Norte: entra ahí y no hay aviso.
	campos["sucursal"] = norte
	st, b = pedir(t, admin, "POST", url, manual(campos, [4]string{"Fenólico", "1", "12100", "21"}))
	if st != 200 {
		t.Fatalf("con caja: %d %s", st, b)
	}
	if r := leerJSON[map[string]string](t, b); r["aviso"] != "" {
		t.Fatalf("aviso de más: %s", b)
	}
	if enCaja(cajaNorte) != "12100.00" || enCaja(cajaCentral) != "0" {
		t.Fatalf("caja: norte %s, central %s", enCaja(cajaNorte), enCaja(cajaCentral))
	}

	// Una sucursal que no es un id no pasa.
	campos["sucursal"] = "norte"
	if st, b := pedir(t, admin, "POST", url, manual(campos, [4]string{"Fenólico", "1", "12100", "21"})); st != 422 {
		t.Fatalf("sucursal inválida: %d %s", st, b)
	}
}

// A cuenta corriente, la factura manual pasa por el mismo control de crédito
// que Cobrar: sin límite, bloqueada o pasada del límite no se fía.
func TestFacturaManualACuentaControlaElCredito(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	url := e.srv.URL + "/api/v1/admin/facturacion/comprobantes"
	var sinLimite, conLimite string
	e.uno(t, `INSERT INTO customers (nombre) VALUES ('Sin límite') RETURNING id`, &sinLimite)
	e.uno(t, `INSERT INTO customers (nombre, limite_credito) VALUES ('Con límite', 20000) RETURNING id`, &conLimite)
	deuda := func(cliente string) string {
		var m string
		e.uno(t, `SELECT coalesce(sum(monto), 0)::text FROM account_movements WHERE customer_id = $1`, &m, cliente)
		return m
	}
	aCuenta := func(cliente, precio string) (int, string) {
		campos := consumidor()
		campos["customerId"], campos["comoPaga"] = cliente, "cuenta_corriente"
		st, b := pedir(t, admin, "POST", url, manual(campos, [4]string{"Fenólico", "1", precio, "21"}))
		return st, string(b)
	}

	if st, b := aCuenta(sinLimite, "12100"); st != 422 || !strings.Contains(b, "no tiene cuenta corriente habilitada. Cobralo de otra forma") {
		t.Fatalf("sin límite: %d %s", st, b)
	}
	if deuda(sinLimite) != "0" {
		t.Fatalf("quedó deuda: %s", deuda(sinLimite))
	}
	if st, b := aCuenta(conLimite, "12100"); st != 200 {
		t.Fatalf("dentro del límite: %d %s", st, b)
	}
	// La segunda se pasa del límite (12.100 + 12.100 > 20.000).
	if st, b := aCuenta(conLimite, "12100"); st != 422 || !strings.Contains(b, "Cobralo de otra forma") {
		t.Fatalf("pasado del límite: %d %s", st, b)
	}
	if deuda(conLimite) != "12100.00" {
		t.Fatalf("deuda: %s", deuda(conLimite))
	}
	var facturas int
	e.uno(t, `SELECT count(*) FROM invoices`, &facturas)
	if facturas != 1 {
		t.Fatalf("se emitieron %d (las rechazadas no tienen que quedar)", facturas)
	}

	// Una ficha nueva a cuenta corriente: se frena antes de crearla.
	campos := map[string]string{"receptorNombre": "Nuevo SA", "receptorCuit": "30-71234567-1", "receptorCondicionIva": "responsable_inscripto",
		"guardarComoCliente": "on", "comoPaga": "cuenta_corriente"}
	if st, b := pedir(t, admin, "POST", url, manual(campos, [4]string{"Fenólico", "1", "12100", "21"})); st != 422 {
		t.Fatalf("ficha nueva a cuenta: %d %s", st, b)
	}
	var fichas int
	e.uno(t, `SELECT count(*) FROM customers WHERE cuit = '30712345671'`, &fichas)
	if fichas != 0 {
		t.Fatal("quedó la ficha huérfana")
	}
}
