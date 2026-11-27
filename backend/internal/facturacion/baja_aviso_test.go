package facturacion

import (
	"context"
	"testing"

	"mjbj/internal/sqlc"
)

// La baja le avisa al cliente del comprobante que no vale (M3S4-009), al que
// cambió de número se le reenvía con el nuevo (M2S1-010, M2S4-018), y Dados
// de baja dice quién usa hoy el número que se liberó (M3S2-044).
func TestLaBajaAvisaYMarcaElReuso(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	conFichaDeGomez(t, e)
	var ids []string
	for _, p := range []string{"1000", "2000", "3000"} {
		ids = append(ids, emitirA(t, e, admin, p))
	}
	trabajos := func(tipo string) int {
		var n int
		e.uno(t, `SELECT count(*)::int FROM trabajos WHERE tipo = $1`, &n, tipo)
		return n
	}
	if st, b := darDeBaja(t, e, admin, ids[0]); st != 200 {
		t.Fatalf("baja: %d %s", st, b)
	}
	if n := trabajos(TrabajoAvisoDeBaja); n != 1 {
		t.Fatalf("avisos de baja: %d", n)
	}
	var carga string
	e.uno(t, `SELECT carga::text FROM trabajos WHERE tipo = $1`, &carga, TrabajoAvisoDeRenumerada)
	if carga == "" {
		t.Fatal("el corrido no se reenvió")
	}
	var anterior string
	e.uno(t, `SELECT carga->>'anterior' FROM trabajos WHERE tipo = $1`, &anterior, TrabajoAvisoDeRenumerada)
	if anterior != "Factura A 0003-00000003" {
		t.Fatalf("el número viejo del reenvío: %q", anterior)
	}

	bajas, err := e.s.DadosDeBaja(context.Background())
	if err != nil || len(bajas) != 1 || bajas[0].Reuso == nil || bajas[0].Reuso.InvoiceID != ids[2] {
		t.Fatalf("el reuso del número: %+v %v", bajas, err)
	}
}

// La nota de crédito le llega al cliente como la factura (M3S3-042).
func TestLaNotaDeCreditoSeLeMandaAlCliente(t *testing.T) {
	e := armar(t, false)
	admin := e.staff(t, "admin@mjbj.test", sqlc.StaffRoleAdmin)
	conFichaDeGomez(t, e)
	id := emitirA(t, e, admin, "12100")
	e.exec(t, `UPDATE invoices SET cae = '71234567890123', estado = 'autorizada' WHERE id = $1`, id)
	antes := 0
	e.uno(t, `SELECT count(*)::int FROM trabajos WHERE tipo = $1`, &antes, TrabajoAvisoDeFactura)
	c, _ := e.s.Obtener(context.Background(), id)
	st, b := pedir(t, admin, "POST", e.srv.URL+"/api/v1/admin/facturacion/comprobantes/"+id+"/nota-de-credito", map[string]any{"motivo": "Devolvió una",
		"parciales": []map[string]any{{"itemId": c.Items[0].ID, "cantidad": 1}}})
	if st != 200 {
		t.Fatalf("nota: %d %s", st, b)
	}
	nota := leerJSON[map[string]string](t, b)["invoiceId"]
	var n int
	e.uno(t, `SELECT count(*)::int FROM trabajos WHERE tipo = $1 AND carga->>'invoiceId' = $2`, &n, TrabajoAvisoDeFactura, nota)
	if n != 1 {
		t.Fatalf("aviso de la nota: %d (antes %d)", n, antes)
	}
}
