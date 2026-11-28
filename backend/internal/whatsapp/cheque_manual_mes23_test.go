package whatsapp

import (
	"strings"
	"testing"
)

// M2S4-017 y M2S3-088: el «Avisar por WhatsApp» de un cheque terminado dice
// lo que le pasó. El que no se tomó nunca entró, y el devuelto no lo
// rechazó el banco; los dos decían «no se pudo acreditar… El importe volvió
// a tu cuenta corriente». Y «el cheque Sim Banco BBVA N° …», sin «Cheque»
// repetido.
func TestAvisoManualDelChequeTerminado(t *testing.T) {
	nombre, tel := "Roberto Ferreyra", "2235550000"
	valores := map[string]string{"cheque": ChequeEnLaPlantilla("fisico", ptr("Sim Banco BBVA"), "99001001"), "importe": "$ 200.000", "motivo": "No recibimos el físico"}
	for _, caso := range []struct {
		desde        string
		volvio       bool
		dice, nodice string
	}{
		{"informado", false, "que nos informaste no lo pudimos tomar. Tu cuenta no cambió", "volvió a tu cuenta"},
		{"cartera", true, "te devolvimos el cheque Sim Banco BBVA N° 99001001 por $ 200.000 sin depositarlo. El importe volvió a tu cuenta corriente", "no se pudo acreditar"},
		{"cartera", false, "sin depositarlo. Tu cuenta no cambió", "volvió a tu cuenta"},
		{"depositado", true, "no se pudo acreditar (No recibimos el físico). El importe volvió a tu cuenta corriente", "te devolvimos"},
	} {
		a := armarConCuerpo("cheque_rechazado", CuerpoDelChequeTerminado(caso.desde, caso.volvio), &nombre, &tel, valores, nil)
		if !strings.Contains(a.Texto, caso.dice) || strings.Contains(a.Texto, caso.nodice) || strings.Contains(a.Texto, "cheque Cheque") {
			t.Errorf("%s %v: %q", caso.desde, caso.volvio, a.Texto)
		}
		if caso.desde != "depositado" && strings.Contains(a.Texto, "No recibimos el físico") {
			t.Errorf("%s: el motivo de la casa llega al cliente: %q", caso.desde, a.Texto)
		}
	}
}
