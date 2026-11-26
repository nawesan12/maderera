package compras

import "testing"

// La bitácora dice con qué se pagó de verdad: un e-Cheq de tercero, un
// cheque propio y una transferencia no es «por transferencia» (simulación
// del mes, H381).
func TestMediosDelPagoEnLaBitacora(t *testing.T) {
	cartera := "c1"
	d := FormPago{Medio: "transferencia", Partes: []ParteDePago{
		{Medio: "echeq", Importe: 1000, ChequeID: &cartera}, {Medio: "cheque", Importe: 500, Cheque: &ChequeNuevo{}},
		{Medio: "transferencia", Importe: 200}, {Medio: "efectivo", Importe: 0},
	}}
	if m := mediosDelPago(d); m != "e-Cheq endosado, cheque propio y transferencia" {
		t.Fatalf("medios: %q", m)
	}
	if m := mediosDelPago(FormPago{Medio: "efectivo"}); m != "efectivo" {
		t.Fatalf("sin partes: %q", m)
	}
}
