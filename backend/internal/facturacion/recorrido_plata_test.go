package facturacion

import (
	"context"
	"testing"

	"mjbj/internal/sqlc"
)

// Recorrido M4-105, M4-098 y M4-104: la factura manual cobrada con débito
// dice «débito» en Cobros, como Cobranzas; al corregir el receptor, el recibo
// del que no tiene ficha cambia de nombre con ella; y la nota de crédito que
// la acreditó va en Cobros.
func TestLaManualCobradaConDebito(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	url := e.srv.URL + "/api/v1/admin/facturacion/comprobantes"
	campos := map[string]string{"receptorNombre": "Pedro Vesino", "receptorCondicionIva": "consumidor_final", "comoPaga": "contado", "medio": "tarjeta_debito"}
	st, b := pedir(t, admin, "POST", url, manual(campos, [4]string{"Flete", "1", "12100", "21"}))
	if st != 200 {
		t.Fatalf("contado: %d %s", st, b)
	}
	id := leerJSON[map[string]string](t, b)["invoiceId"]
	c, err := e.s.Obtener(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Cobros) != 1 || c.Cobros[0].Medio != "tarjeta_debito" {
		t.Fatalf("cobros: %+v", c.Cobros)
	}
	if err := e.s.CorregirReceptor(ctx, id, map[string]string{"receptorNombre": "Pedro Vecino", "receptorCondicionIva": "consumidor_final"}); err != nil {
		t.Fatal(err)
	}
	var nombre string
	e.uno(t, `SELECT r.recibido_de FROM receipts r JOIN invoice_payments p ON p.receipt_id = r.id WHERE p.invoice_id = $1`, &nombre, id)
	if nombre != "Pedro Vecino" {
		t.Errorf("el recibo: %q", nombre)
	}
	var nota string
	e.uno(t, `INSERT INTO invoices (tipo, punto_venta, numero, receptor_nombre, neto, iva21, iva105, iva27, tributos, total, estado, fecha_emision, comprobante_origen_id)
		SELECT 'nota_credito_b', punto_venta, 1, receptor_nombre, 5000, 1050, 0, 0, 0, 6050, 'emitida', now(), id FROM invoices WHERE id = $1 RETURNING id`, &nota, id)
	c, err = e.s.Obtener(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.NotasDeCredito) != 1 || c.NotasDeCredito[0].ID != nota || c.NotasDeCredito[0].Total != 6050 {
		t.Errorf("notas: %+v", c.NotasDeCredito)
	}
}

// Recorrido M4-020: la condición de venta dice la marca y las cuotas de la
// tarjeta con que se cobró en la caja, en el mismo renglón.
func TestLaCondicionDeVentaDiceLasCuotas(t *testing.T) {
	naranja := "Naranja"
	c := &Completo{CobrosDelPedido: []CobroDelPedido{{Medio: "credito", Tarjeta: &naranja, Cuotas: 6}, {Medio: "efectivo", Cuotas: 1}}}
	if got := condicionDeVenta(c); got != "Contado · Tarjeta de crédito · Naranja · 6 cuotas, Efectivo" {
		t.Errorf("%q", got)
	}
	if got := condicionDeVenta(&Completo{CobrosDelPedido: []CobroDelPedido{{Medio: "debito", Cuotas: 1}}}); got != "Contado · Tarjeta de débito" {
		t.Errorf("%q", got)
	}
}
