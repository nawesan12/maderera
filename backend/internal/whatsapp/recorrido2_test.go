package whatsapp

import (
	"strings"
	"testing"
)

// Recorrido 2 (nuevo 9): con el correo de demostración, la ficha del pedido
// decía «El correo salió el 28/11, 13:48» mientras /admin/avisos lo marcaba
// «Simulado».
func TestElCorreoSimuladoNoDiceQueSalio(t *testing.T) {
	e := armar(t, false)
	id := "6f1c1b7e-2a4d-4c3e-9b8a-1d2e3f4a5b6c"
	if _, err := e.pool.Exec(e.ctx, `insert into notifications_log (canal, evento, destinatario, estado, entidad_id)
		values ('email', 'pedido_enviado', 'sim.valeria@ejemplo.test', 'simulada', $1)`, id); err != nil {
		t.Fatal(err)
	}
	h, _, err := e.wa.historiaDelAviso(e.ctx, "pedido_enviado", id)
	if err != nil || len(h) != 1 {
		t.Fatal(err, h)
	}
	if strings.Contains(h[0].Texto, "salió el") || !strings.Contains(h[0].Texto, "simulado") {
		t.Errorf("correo simulado: %q", h[0].Texto)
	}
}
