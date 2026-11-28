package compras

import (
	"strings"
	"testing"
)

// Mes 23: un gasto con factura A sin punto de venta se guardaba como
// 0000-00000345 y así entraba al libro IVA compras.
func TestElGastoConFacturaPideElPuntoDeVenta(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	gasto := map[string]any{"fecha": "2026-11-10", "categoria": "servicios", "descripcion": "Luz", "importe": 121000,
		"medio": "transferencia", "supplierId": e.proveedor,
		"factura": map[string]any{"tipo": "factura_a", "puntoVenta": 0, "numero": 345, "iva21": 21000}}
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); c != 422 || !strings.Contains(b, "punto de venta") {
		t.Errorf("sin punto de venta: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from purchase_invoices`); n != 0 {
		t.Errorf("quedó la factura: %v", n)
	}
	// El ticket puede no tener punto de venta.
	gasto["factura"] = map[string]any{"tipo": "ticket", "puntoVenta": 0, "numero": 345}
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); c != 200 {
		t.Errorf("ticket: %d %s", c, b)
	}
}
