package facturacion

import (
	"testing"

	"mjbj/internal/sqlc"
)

// El cobro de una factura por depósito, e-Cheq o retención queda con su
// medio (decía «Transferencia» de un depósito, M3S2-039), y cada cobro trae
// el número de su recibo (la manual decía «recibo» sin número, M2S3-090).
func TestElCobroDeLaFacturaGuardaSuMedioYSuRecibo(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "a@mjbj.test", sqlc.StaffRoleAdmin)
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes", manual(consumidor(), [4]string{"Fenólico", "1", "30000", "21"}))
	if st != 200 {
		t.Fatalf("emitir: %d %s", st, b)
	}
	id := leerJSON[map[string]string](t, b)["invoiceId"]
	if st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/cobros",
		map[string]string{"partes": `[{"medio":"deposito","importe":"20000","referencia":"SIM-DEP-0801"}]`}); st != 200 {
		t.Fatalf("cobrar: %d %s", st, b)
	}
	st, b = pedir(t, admin, "GET", e.srv.URL+"/api/v1/comprobantes/"+id, nil)
	f := leerJSON[Completo](t, b)
	if st != 200 || len(f.Cobros) != 1 || f.Cobros[0].Medio != "deposito" || f.Cobros[0].Recibo == nil || *f.Cobros[0].Recibo == "" {
		t.Fatalf("cobro: %s", b)
	}
	if f.Saldo != 10000 {
		t.Fatalf("saldo: %v", f.Saldo)
	}
}
