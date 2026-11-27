package compras

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/reglas"
)

// El CAE de una compra: catorce números, nunca el de otro comprobante (el
// libro IVA compras tenía el mismo CAE en facturas de tres proveedores,
// M2S2-039 y M3S1-051), y con la regla cae_en_compras en «exigido», la que
// da crédito fiscal no entra sin él. El gasto con factura lo controla igual.
func TestElCaeDeLaCompra(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	factura := func(numero int, cae any) (int, string) {
		f := map[string]any{"supplierId": e.proveedor, "tipo": "factura_a", "puntoVenta": 3,
			"numero": numero, "fechaEmision": "2026-11-01", "neto": 1000, "iva21": 210, "iva105": 0, "iva27": 0, "exento": 0,
			"percepciones": 0}
		if cae != nil {
			f["cae"] = cae
		}
		return pedir(t, adm, "POST", e.u+"compras/facturas", f)
	}
	if c, b := factura(1, "76123456789012"); c != 200 {
		t.Fatalf("con CAE: %d %s", c, b)
	}
	if c, b := factura(2, "76123456789012"); c != 422 || !strings.Contains(b, "Ese CAE ya está en Factura A 0003-00000001") {
		t.Errorf("CAE repetido: %d %s", c, b)
	}
	if c, b := factura(3, "7612"); c != 422 || !strings.Contains(b, "14 números") {
		t.Errorf("CAE corto: %d %s", c, b)
	}
	// De arranque, sin CAE entra (como siempre).
	if c, b := factura(4, nil); c != 200 {
		t.Fatalf("sin CAE, opcional: %d %s", c, b)
	}
	if err := reglas.Fijar(context.Background(), e.pool, reglas.CaeEnCompras, "exigido"); err != nil {
		t.Fatal(err)
	}
	if c, b := factura(5, nil); c != 422 || !strings.Contains(b, "sin él no da crédito fiscal") {
		t.Errorf("sin CAE, exigido: %d %s", c, b)
	}
	gasto := map[string]any{"fecha": "2026-11-10", "categoria": "servicios", "descripcion": "Luz del aserradero", "importe": 398700,
		"medio": "transferencia", "branchId": e.aserradero, "supplierId": e.proveedor,
		"factura": map[string]any{"tipo": "factura_a", "puntoVenta": 7, "numero": 1234, "iva21": 69195.87}}
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); c != 422 || !strings.Contains(b, "sin él no da crédito fiscal") {
		t.Errorf("gasto sin CAE, exigido: %d %s", c, b)
	}
	gasto["factura"].(map[string]any)["cae"] = "76123456789012"
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); c != 422 || !strings.Contains(b, "Ese CAE ya está") {
		t.Errorf("gasto con CAE repetido: %d %s", c, b)
	}
	gasto["factura"].(map[string]any)["cae"] = "76123456789013"
	if c, b := pedir(t, adm, "POST", e.u+"compras/gastos", gasto); c != 200 {
		t.Fatalf("gasto con CAE: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from purchase_invoices where cae = '76123456789013'`); n != 1 {
		t.Errorf("el CAE del gasto: %v", n)
	}
}
