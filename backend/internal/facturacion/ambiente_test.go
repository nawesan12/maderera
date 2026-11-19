package facturacion

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/fiscal"
	"mjbj/internal/sqlc"
)

// El CAE guarda de qué ambiente de ARCA salió (revisión del comité, T6): un
// CAE de homologación es de prueba, no va al libro IVA y no lleva notas en
// producción; y al revés, una nota de prueba no corrige un CAE real.
func TestCaeDeHomologacion(t *testing.T) {
	e := armar(t, true)
	ctx := context.Background()
	admin := e.staff(t, "ambiente@mjbj.test", sqlc.StaffRoleAdmin)
	// El simulador de las pruebas hace de producción; acá, de homologación.
	homo := e.s.ConEntorno(func(k string) string {
		if k == "ARCA_AMBIENTE" {
			return ""
		}
		return e.s.env(k)
	})
	prod := e.s
	id, err := homo.EmitirComprobante(ctx, DatosEmision{ReceptorNombre: "CF", ReceptorCondicionIva: "consumidor_final",
		Lineas: []Linea{{LineaEntrada: fiscal.LineaEntrada{Descripcion: "Placa", Cantidad: 3, PrecioFinalUnitario: 1210}}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := homo.Autorizar(ctx, id); err != nil {
		t.Fatal(err)
	}
	var ambiente string
	e.uno(t, `SELECT cae_ambiente FROM invoices WHERE id = $1`, &ambiente, id)
	if ambiente != "homologacion" {
		t.Fatalf("el CAE de homologación quedó con ambiente %q", ambiente)
	}

	// Fuera del libro IVA del mes.
	var mes string
	e.uno(t, `SELECT to_char(fecha_emision AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') FROM invoices WHERE id = $1`, &mes, id)
	_, b := pedir(t, admin, "GET", e.srv.URL+"/api/v1/admin/facturacion/libro-iva?periodo="+mes, nil)
	if l := leerJSON[libroConPeriodo](t, b); len(l.Filas) != 0 {
		t.Fatalf("el CAE de prueba entró al libro: %s", b)
	}

	// En producción no se le hace nota.
	unidad := []fiscal.CantidadAAcreditar{{ItemID: primerItem(t, e, id), Cantidad: 1}}
	if _, err := prod.NotaDeCredito(ctx, id, "Devolución", nil, unidad, false); err == nil || !strings.Contains(Mensaje(err), "homologación") {
		t.Fatalf("nota de producción sobre un CAE de prueba: %v", err)
	}
	// En homologación, sí (es todo de prueba).
	if _, err := homo.NotaDeCredito(ctx, id, "Devolución", nil, unidad, false); err != nil {
		t.Fatal(err)
	}

	// Al revés: un CAE de producción no lleva notas de prueba.
	e.exec(t, `UPDATE invoices SET cae_ambiente = 'produccion' WHERE id = $1`, id)
	if _, err := homo.NotaDeCredito(ctx, id, "Devolución", nil, unidad, false); err == nil || !strings.Contains(Mensaje(err), "producción") {
		t.Fatalf("nota de prueba sobre un CAE real: %v", err)
	}
}

func primerItem(t *testing.T, e *entorno, factura string) string {
	t.Helper()
	var item string
	e.uno(t, `SELECT id::text FROM invoice_items WHERE invoice_id = $1 ORDER BY orden LIMIT 1`, &item, factura)
	return item
}
