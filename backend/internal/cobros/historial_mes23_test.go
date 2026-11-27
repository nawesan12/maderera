package cobros

import (
	"testing"
	"time"
)

// Lo que encontró el mes simulado en Movimientos (tanda 23).

// M2S1-153: el cliente no lee el motivo interno de la anulación de un
// recibo, y el pago anulado y su ajuste se compensan en un renglón.
func TestElReciboAnuladoEnUnRenglon(t *testing.T) {
	motivo := "Anulación del recibo REC-0006: Sim: se cargó por error"
	if v := DetalleParaElCliente(&motivo); v == nil || *v != "Anulación del recibo REC-0006" {
		t.Fatalf("el motivo interno: %v", v)
	}
	pago, ajuste, otro := -1000.0, 1000.0, -500.0
	detallePago := "Transferencia"
	movs := HistorialParaElCliente([]MovimientoDelCliente{
		{ID: "a", Clase: "ajuste", Titulo: "Ajuste", Detalle: &motivo, Importe: &ajuste},
		{ID: "b", Clase: "pago", Titulo: "Pago a cuenta", Detalle: &detallePago, Importe: &pago,
			Recibo: &RefRecibo{ID: "r6", Numero: "REC-0006", Anulado: true}},
		{ID: "c", Clase: "pago", Titulo: "Pago a cuenta", Importe: &otro, Recibo: &RefRecibo{ID: "r7", Numero: "REC-0007"}},
	})
	if len(movs) != 2 {
		t.Fatalf("el ajuste de la anulación sigue aparte: %+v", movs)
	}
	if m := movs[0]; m.ID != "b" || m.Titulo != "Recibo REC-0006 anulado" || m.Importe != nil || m.Detalle != nil {
		t.Errorf("el anulado: %+v", m)
	}
	if m := movs[1]; m.ID != "c" || m.Importe == nil || *m.Importe != -500 {
		t.Errorf("el pago vivo no se toca: %+v", m)
	}
}

// M3S1-044: las fechas de los cheques con ceros, todas iguales.
func TestFechaCortaConCeros(t *testing.T) {
	if f := fechaCorta(time.Date(2027, 1, 15, 15, 0, 0, 0, time.UTC)); f != "15/01/2027" {
		t.Errorf("fecha: %s", f)
	}
}
