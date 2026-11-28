package pagos

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/sqlc"
)

// M2S2-038 (mes 23, no se pudo ver sin una transferencia propia): acreditar
// deja en la bitácora «Acreditó $ … de PED-… (cliente)», con el importe, el
// pedido y el cliente, como el rechazo.
func TestLaBitacoraDiceQueAcreditoYDeQuien(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	pedido, _ := e.pedido(t, "PED-1152")
	pago := e.id(t, `insert into payments (order_id, tipo, proveedor, medio, monto, estado) values ($1, 'pedido', 'transferencia', 'transferencia', 5580, 'en_revision') returning id`, pedido)
	if _, err := e.ses.AltaDeStaff(ctx, "duena2@prueba.test", "una clave larga", "Sim Dueña", sqlc.StaffRoleAdmin); err != nil {
		t.Fatal(err)
	}
	usuario := e.texto(t, `select id from "user" where email = 'duena2@prueba.test'`)
	if _, err := e.s.Conciliar(ctx, &auth.Sesion{UserID: usuario}, pago, "aprobar", nil); err != nil {
		t.Fatal(err)
	}
	d := e.texto(t, `select descripcion from audit_log where entidad = 'pago' and entidad_id = $1`, pago)
	if !strings.HasPrefix(d, "Acreditó $") || !strings.Contains(d, "5.580") || !strings.Contains(d, "de PED-1152") {
		t.Fatalf("bitácora: %q", d)
	}
}
