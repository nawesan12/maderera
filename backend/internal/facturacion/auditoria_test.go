package facturacion

import (
	"context"
	"net/http"
	"testing"

	"mjbj/internal/sqlc"
)

// Lo que encontró la auditoría de facturación e IVA: cada prueba falla sin su
// arreglo.

// **Lo exento contado dos veces.** Un renglón al 0 % iba al neto y al exento:
// a ARCA le llegaba ImpNeto (con lo exento adentro) + ImpOpEx y el total no
// cerraba (10048), y la percepción de IIBB se calculaba sobre lo exento.
func TestExentoNoVaAlNeto(t *testing.T) {
	e := armar(t, true)
	e.exec(t, `UPDATE configuracion_fiscal SET percibe_iibb = true, alicuota_percepcion_iibb = 3`)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	campos := map[string]string{"receptorNombre": "Gómez SRL", "receptorCuit": "30-71234567-1", "receptorCondicionIva": "responsable_inscripto"}
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(campos,
		[4]string{"Fenólico", "1", "12100", "21"}, [4]string{"Libro técnico", "1", "1000", "0"}))
	if st != 200 {
		t.Fatalf("emitir: %d %s", st, b)
	}
	id := leerJSON[map[string]string](t, b)["invoiceId"]
	var neto, exento, tributos, total string
	if err := e.pool.QueryRow(context.Background(), `SELECT neto::text, exento::text, tributos::text, total::text FROM invoices WHERE id = $1`, id).
		Scan(&neto, &exento, &tributos, &total); err != nil {
		t.Fatal(err)
	}
	// Percepción: 3 % de 10.000 (el neto gravado), no de 11.000.
	if neto != "10000.00" || exento != "1000.00" || tributos != "300.00" || total != "13400.00" {
		t.Fatalf("importes: neto %s, exento %s, tributos %s, total %s", neto, exento, tributos, total)
	}
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/autorizar", nil)
	if st != 200 || leerJSON[map[string]string](t, b)["ok"] == "" {
		t.Fatalf("ARCA lo rechaza: %d %s", st, b)
	}

	// La nota de crédito solo del renglón exento no devuelve percepción: no
	// se cobró sobre él.
	c, _ := e.s.Obtener(context.Background(), id)
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/nota-de-credito",
		map[string]any{"motivo": "Devolvió el libro", "parciales": []map[string]any{{"itemId": c.Items[1].ID, "cantidad": 1}}})
	if st != 200 {
		t.Fatalf("nota: %d %s", st, b)
	}
	nc, _ := e.s.Obtener(context.Background(), leerJSON[map[string]string](t, b)["invoiceId"])
	if nc.Total != "1000.00" || nc.Neto != "0.00" || nc.Exento != "1000.00" {
		t.Fatalf("nota del exento: total %s, neto %s, exento %s", nc.Total, nc.Neto, nc.Exento)
	}
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+nc.ID+"/autorizar", nil)
	if st != 200 || leerJSON[map[string]string](t, b)["ok"] == "" {
		t.Fatalf("la nota: %d %s", st, b)
	}
}

// autorizarPorAPI pide el CAE y falla si ARCA no lo da.
func autorizarPorAPI(t *testing.T, e *entorno, admin *http.Client, id string) {
	t.Helper()
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/autorizar", nil)
	if st != 200 || leerJSON[map[string]string](t, b)["ok"] == "" {
		t.Fatalf("autorizar: %d %s", st, b)
	}
}

// **Notas sobre notas.** Una nota de crédito se revierte con una nota de
// débito de la misma letra, y una nota de débito se anula con una nota de
// crédito. El TS solo reemplazaba el prefijo «factura»: sobre una nota
// devolvía el mismo tipo, y la nota de débito sobre una nota de crédito
// salía como crédito (y al revés), con el signo de la cuenta corriente al
// revés.
func TestNotasSobreNotas(t *testing.T) {
	e := armar(t, true)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	ctx := context.Background()
	campos := map[string]string{"receptorNombre": "Gómez SRL", "receptorCuit": "30-71234567-1", "receptorCondicionIva": "responsable_inscripto",
		"guardarComoCliente": "on"}
	_, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(campos, [4]string{"Fenólico", "10", "12100", "21"}))
	fa := leerJSON[map[string]string](t, b)["invoiceId"]
	autorizarPorAPI(t, e, admin, fa)
	c, _ := e.s.Obtener(ctx, fa)
	cliente := *c.CustomerID
	saldo := func() float64 {
		var s float64
		e.uno(t, `SELECT sum(monto)::float8 FROM account_movements WHERE customer_id = $1`, &s, cliente)
		return s
	}

	// La nota de crédito parcial de la factura (2 placas).
	_, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+fa+"/nota-de-credito",
		map[string]any{"motivo": "Devolvió dos", "parciales": []map[string]any{{"itemId": c.Items[0].ID, "cantidad": 2}}})
	nc, _ := e.s.Obtener(ctx, leerJSON[map[string]string](t, b)["invoiceId"])
	if nc.Tipo != "nota_credito_a" {
		t.Fatalf("la nota de la factura: %s", nc.Tipo)
	}
	autorizarPorAPI(t, e, admin, nc.ID)
	if s := saldo(); s != 121000-24200 {
		t.Fatalf("saldo después de la nota de crédito: %v", s)
	}

	// Anular la nota de crédito: una nota de débito A, que vuelve a cargar.
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+nc.ID+"/anular", map[string]string{"motivo": "Al final no devolvió"})
	if st != 200 {
		t.Fatalf("anular la nota: %d %s", st, b)
	}
	nd, _ := e.s.Obtener(ctx, leerJSON[map[string]string](t, b)["invoiceId"])
	if nd.Tipo != "nota_debito_a" || nd.Total != "24200.00" {
		t.Fatalf("el reverso de la nota de crédito: %s %s", nd.Tipo, nd.Total)
	}
	autorizarPorAPI(t, e, admin, nd.ID)
	if s := saldo(); s != 121000 {
		t.Fatalf("saldo después de revertir la nota de crédito: %v", s)
	}

	// Un cargo sobre la factura (nota de débito) y su anulación: una nota de
	// crédito que descuenta.
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+fa+"/nota-de-debito",
		map[string]any{"motivo": "Flete olvidado", "concepto": "Flete", "importe": 12100, "alicuota": 21})
	if st != 200 {
		t.Fatalf("débito: %d %s", st, b)
	}
	flete, _ := e.s.Obtener(ctx, leerJSON[map[string]string](t, b)["invoiceId"])
	autorizarPorAPI(t, e, admin, flete.ID)
	if s := saldo(); s != 133100 {
		t.Fatalf("saldo con el flete: %v", s)
	}
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+flete.ID+"/anular", map[string]string{"motivo": "El flete era gratis"})
	if st != 200 {
		t.Fatalf("anular el débito: %d %s", st, b)
	}
	ncFlete, _ := e.s.Obtener(ctx, leerJSON[map[string]string](t, b)["invoiceId"])
	if ncFlete.Tipo != "nota_credito_a" {
		t.Fatalf("el reverso de la nota de débito: %s", ncFlete.Tipo)
	}
	autorizarPorAPI(t, e, admin, ncFlete.ID)
	if s := saldo(); s != 121000 {
		t.Fatalf("saldo final: %v", s)
	}
}
