package compras

import (
	"encoding/json"
	"strings"
	"testing"
)

// Las pruebas del grupo de compras del recorrido M4.

// M4-036: «Sube $ 150.000» y después «Baja $ 150.000» aplicado al primero:
// el saldo queda en cero y el ajuste ya no figura para pagarse.
func TestAjusteQueBajaSeAplicaAlQueSubio(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	mov := func(extra map[string]any) (int, string) {
		cuerpo := map[string]any{"supplierId": e.proveedor, "tipo": "ajuste", "monto": 150000, "detalle": "Saldo inicial"}
		for k, v := range extra {
			cuerpo[k] = v
		}
		return pedir(t, adm, "POST", e.u+"proveedores/"+e.proveedor+"/movimientos", cuerpo)
	}
	if c, b := mov(map[string]any{"sentido": "sube", "referencia": "SIM-SI-0001"}); c != 200 {
		t.Fatalf("sube: %d %s", c, b)
	}
	_, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil)
	var fs []FacturaConSaldo
	_ = json.Unmarshal([]byte(b), &fs)
	if len(fs) != 1 || fs[0].Tipo != "ajuste" {
		t.Fatalf("el ajuste abierto: %s", b)
	}
	if c, b := mov(map[string]any{"sentido": "baja", "monto": 200000, "aplicaA": fs[0].ID}); c != 422 || !strings.Contains(b, "le quedan") {
		t.Errorf("uno mayor que el abierto: %d %s", c, b)
	}
	if c, b := mov(map[string]any{"sentido": "baja", "aplicaA": fs[0].ID, "detalle": "Se compensa"}); c != 200 {
		t.Fatalf("baja: %d %s", c, b)
	}
	if _, b := pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor+"/facturas-con-saldo", nil); b != "[]\n" {
		t.Errorf("el ajuste compensado sigue por pagar: %s", b)
	}
	if s := e.saldo(t); s != 0 {
		t.Errorf("saldo: %v", s)
	}
	// Pagarlo igual no se puede: ya no se le debe.
	c, b := pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 150000, "medio": "transferencia",
		"retenciones": []any{}, "ajustes": []any{map[string]any{"movimientoId": fs[0].ID, "importe": 150000}}})
	if c != 422 {
		t.Errorf("se pagó un ajuste compensado: %d %s", c, b)
	}
	_, b = pedir(t, adm, "GET", e.u+"proveedores/"+e.proveedor, nil)
	if !strings.Contains(b, `"aplicaA":"ajuste SIM-SI-0001"`) {
		t.Errorf("el renglón no dice a qué se aplicó: %s", b)
	}
}
