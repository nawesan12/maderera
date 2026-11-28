package compras

import (
	"strings"
	"testing"
)

// Recorrido 2 (nuevo 2): Techos Pampa tenía los dos remitos de OC-11
// confirmados ($ 10.000 cada uno, ya en la deuda) y la Factura C por
// $ 20.000 se cargó sin tildarlos: la deuda quedó en $ 40.000. Ahora la
// factura sin remitos se frena una vez; atada a los dos, la deuda queda en
// $ 20.000, y si de verdad no cubre ninguno, se guarda diciéndolo.
func TestLaFacturaSinRemitosNoDuplicaLaDeuda(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	e.pool.Exec(t.Context(), `update suppliers set condicion_iva = 'monotributo' where id = $1`, e.proveedor)
	recibir := func() string {
		c, b := pedir(t, adm, "POST", e.u+"recepciones", map[string]any{"supplierId": e.proveedor, "branchId": e.central,
			"lineas": []any{map[string]any{"variantId": e.placa, "cantidad": 1, "costoUnitario": 10000, "alicuotaIva": 0}}})
		if c != 200 {
			t.Fatalf("crear: %d %s", c, b)
		}
		id := idDe(t, b)
		if c, b := pedir(t, adm, "POST", e.u+"recepciones/"+id+"/confirmar", nil); c != 200 {
			t.Fatalf("confirmar: %d %s", c, b)
		}
		return id
	}
	r1, r2 := recibir(), recibir()
	if s := e.saldo(t); s != 20000 {
		t.Fatalf("deuda de las recepciones: %v", s)
	}
	factura := func(numero int, extra map[string]any) (int, string) {
		f := map[string]any{"supplierId": e.proveedor, "tipo": "factura_c", "puntoVenta": 2, "numero": numero, "fechaEmision": "2026-11-28",
			"neto": 20000, "iva21": 0, "iva105": 0, "iva27": 0, "exento": 0, "percepciones": 0}
		for k, v := range extra {
			f[k] = v
		}
		return pedir(t, adm, "POST", e.u+"compras/facturas", f)
	}
	if c, b := factura(95, nil); c != 422 || !strings.Contains(b, "2 remitos sin factura") {
		t.Errorf("sin tildar los remitos: %d %s", c, b)
	}
	if s := e.saldo(t); s != 20000 {
		t.Errorf("la factura frenada no tocó la deuda: %v", s)
	}
	if c, b := factura(95, map[string]any{"receiptId": r1, "receiptIds": []string{r2}}); c != 200 {
		t.Fatalf("con los dos remitos: %d %s", c, b)
	}
	if s := e.saldo(t); s != 20000 {
		t.Errorf("atada a los remitos, la deuda es la factura: %v (20.000)", s)
	}
	// Con un remito nuevo sin facturar y una factura que no lo cubre.
	recibir()
	if c, b := factura(96, map[string]any{"neto": 5000, "sinRemitos": true}); c != 200 {
		t.Fatalf("no cubre ninguno: %d %s", c, b)
	}
	if s := e.saldo(t); s != 35000 {
		t.Errorf("la que no cubre remitos suma su total: %v (35.000)", s)
	}
}
