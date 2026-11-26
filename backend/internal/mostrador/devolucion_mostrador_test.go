package mostrador

import (
	"testing"

	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
)

// Devolver uno de cuatro desde el mostrador (mes simulado, H270): antes había
// que anular la venta entera, devolver todo y cobrar de nuevo. Al vendedor le
// pide la firma de un admin por el importe, como anular.
func TestDevolucionDesdeElMostrador(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	c := e.vendidaYFacturada(t, "admin@prueba.test", VentaPedida{MedioPago: ventas.Debito, Lineas: placas(e, 4, 1000)})
	e.svc.ConFacturacion(c.fac)
	e.conPIN(t)
	u := e.u + "/api/v1/mostrador/ventas/" + c.pedido + "/devolucion"

	if st, m, b := pedir(t, ven, "GET", u, nil); st != 200 || m["renglones"] == nil {
		t.Fatalf("datos: %d %s", st, b)
	}
	renglones := []map[string]any{{"itemId": c.renglon, "cantidad": 1, "alStock": true}}
	st, m, b := pedir(t, ven, "POST", u+"/calculo", map[string]any{"renglones": renglones})
	if st != 200 || m["importe"] != 1000.0 {
		t.Fatalf("cálculo: %d %s", st, b)
	}
	pedido := map[string]any{"clave": claveDeDevolucion(), "destino": "afuera", "motivo": "Le sobró una", "importe": 1000, "renglones": renglones}
	if _, m, b := pedir(t, ven, "POST", u, pedido); m["autorizacion"] == nil {
		t.Fatalf("sin PIN, el vendedor devolvía: %s", b)
	} else if a, _ := m["autorizacion"].(map[string]any); a["motivo"] != "devolver" {
		// El campo del PIN decía «Anular $ 1.000» sobre una devolución (H270).
		t.Errorf("la firma de la devolución: %s", b)
	}
	pedido["pin"] = pinDeLaDuena
	if st, m, b := pedir(t, ven, "POST", u, pedido); st != 200 || m["ok"] == nil {
		t.Fatalf("con PIN: %d %s", st, b)
	}
	if n := e.num(t, `select count(*)::float8 from devoluciones where order_id = $1`, c.pedido); n != 1 {
		t.Errorf("devoluciones: %v", n)
	}
}
