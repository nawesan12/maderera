package facturacion

import (
	"context"
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
