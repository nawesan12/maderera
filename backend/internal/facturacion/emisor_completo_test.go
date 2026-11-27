package facturacion

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Sin el N° de Ingresos Brutos o el inicio de actividades, que van impresos
// en el comprobante (RG 1415), no se le pide el CAE a ARCA: el comprobante
// autorizado salía sin ellos (M2S1-016). Emitir sin CAE sigue igual.
func TestSinLosDatosDelEmisorNoSeAutoriza(t *testing.T) {
	e := armar(t, true)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	e.exec(t, `UPDATE configuracion_fiscal SET ingresos_brutos = NULL, inicio_actividades = NULL`)
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(consumidor(), [4]string{"Fenólico", "1", "12100", "21"}))
	if st != 200 {
		t.Fatalf("emitir: %d %s", st, b)
	}
	id := leerJSON[map[string]string](t, b)["invoiceId"]
	if _, err := e.s.Autorizar(context.Background(), id); !strings.Contains(Mensaje(err), "Ingresos Brutos y el inicio de actividades") {
		t.Fatalf("autorizar sin los datos: %v", err)
	}
	e.exec(t, `UPDATE configuracion_fiscal SET ingresos_brutos = '901-123456-7', inicio_actividades = '1981-03-01'`)
	if _, err := e.s.Autorizar(context.Background(), id); err != nil {
		t.Fatalf("con los datos: %v", err)
	}
}
