package compras

import (
	"context"
	"strings"
	"testing"
)

// Un cheque de la cartera se endosa solo en un pago de su circuito (comité
// final, M8): el del B en un pago blanco salía de Valores a depositar del
// estudio, donde nunca había entrado.
func TestElEndosoNoCruzaDeCircuito(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", "admin")
	ctx := context.Background()
	cheque := func(numero, circuito string) string {
		var id string
		if err := e.pool.QueryRow(ctx, `insert into cheques (sentido, tipo, numero, fecha_pago, importe, estado, circuito)
			values ('recibido', 'fisico', $1, now(), 500, 'cartera', $2) returning id`, numero, circuito).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	pagar := func(circuito, chequeID string) (int, string) {
		return pedir(t, adm, "POST", e.u+"compras/pagos", map[string]any{"supplierId": e.proveedor, "total": 500, "medio": "cheque",
			"circuito": circuito, "retenciones": []any{}, "imputaciones": []any{}, "partes": []any{map[string]any{"medio": "cheque", "importe": 500, "chequeId": chequeID, "cheque": nil}}})
	}
	negro, blanco := cheque("11111111", "negro"), cheque("22222222", "blanco")
	if c, b := pagar("blanco", negro); c != 422 || !strings.Contains(b, "circuito B") {
		t.Errorf("el cheque B en un pago blanco: %d %s", c, b)
	}
	if c, b := pagar("negro", blanco); c != 422 || !strings.Contains(b, "circuito blanco") {
		t.Errorf("el cheque blanco en un pago B: %d %s", c, b)
	}
	if c, b := pagar("negro", negro); c != 200 {
		t.Errorf("el cheque B en un pago B: %d %s", c, b)
	}
	if c, b := pagar("blanco", blanco); c != 200 {
		t.Errorf("el cheque blanco en un pago blanco: %d %s", c, b)
	}
}
