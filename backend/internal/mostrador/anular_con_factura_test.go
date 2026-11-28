package mostrador

import (
	"strings"
	"testing"

	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
)

// Anular una venta con factura sin CAE la da de baja en el mismo paso: no se
// va a autorizar y seguía viva sumando en Facturación hasta que alguien la
// daba de baja a mano (mes simulado, M2S2-034).
func TestAnularLaVentaDaDeBajaSuFacturaSinCAE(t *testing.T) {
	e := armar(t)
	admin := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	c := e.vendidaSinFactura(t, "admin@prueba.test", VentaPedida{MedioPago: ventas.Debito, Lineas: placas(e, 2, 1000)})
	if res, err := c.facturar(t); err != nil || res.InvoiceID == nil {
		t.Fatalf("facturar: %v %+v", err, res)
	}
	e.svc.ConFacturacion(c.fac)
	st, m, b := pedir(t, admin, "POST", e.u+"/api/v1/mostrador/ventas/"+c.pedido+"/anular", map[string]any{"motivo": "Se equivocó de cliente"})
	if st != 200 || m["facturaPendiente"] != nil || !strings.Contains(m["ok"].(string), "se dio de baja") {
		t.Fatalf("anular: %d %s", st, b)
	}
	if n := e.num(t, `select count(*)::float8 from invoices where order_id = $1`, c.pedido); n != 0 {
		t.Fatalf("la factura sigue viva: %v", n)
	}
	if m := e.txt(t, `select motivo from invoices_dadas_de_baja where order_id = $1`, c.pedido); m != "Venta anulada: Se equivocó de cliente" {
		t.Fatalf("baja: %q", m)
	}
}
