package facturacion

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Mes 23: el cobro con un e-Cheq cuyo número tiene una letra (E0055502) no
// se registraba y la pantalla no decía nada. Go lo rechaza con el mensaje
// del campo (lo que muestra mensajeDe), y no queda cobro a medias.
func TestElEcheqConLetraSeRechazaConMensaje(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(consumidor(), [4]string{"Fenólico", "1", "30000", "21"}))
	if st != 200 {
		t.Fatalf("emitir: %d %s", st, b)
	}
	id := leerJSON[map[string]string](t, b)["invoiceId"]
	st, b = pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/cobros",
		map[string]string{"partes": `[{"medio":"echeq","importe":"30000","cheque":{"numero":"E0055502","banco":"Banco Galicia","fechaPago":"2026-11-27"}}]`})
	if st != 422 || !strings.Contains(string(b), "solo números") || !strings.Contains(string(b), `"errores"`) {
		t.Fatalf("cobrar: %d %s", st, b)
	}
	st, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+id, nil)
	if f := leerJSON[Completo](t, b); st != 200 || len(f.Cobros) != 0 {
		t.Fatalf("quedó un cobro: %s", b)
	}
}
