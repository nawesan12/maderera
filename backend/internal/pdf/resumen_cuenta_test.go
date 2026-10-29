package pdf

import (
	"testing"
	"time"
)

// En el TS, recortar() mide el concepto sin limpiarlo y pdf-lib tira «WinAnsi
// cannot encode» con un emoji o una flecha: la descarga del resumen entero
// daba 500. En Go el resumen sale y el carácter se saca al escribir.
func TestResumenConEmojiEnElConcepto(t *testing.T) {
	ref := "FA → 12"
	d := DatosResumenCuenta{Resumen: ResumenDeCuenta{
		Cliente: ClienteDelResumen{Nombre: "Juan"},
		Movimientos: []MovimientoDelResumen{{
			Fecha: time.Now(), Tipo: "compra", Detalle: "Compra de placas 😀 con un concepto bastante largo para que haya que recortarlo",
			Referencia: &ref, Monto: 10, Saldo: 10,
		}},
		Saldo: 10,
	}}
	if _, err := ResumenCuenta(d, time.Now()); err != nil {
		t.Fatalf("el resumen no salió: %v", err)
	}
	if got := resumenRecortar("Compra 😀 con un concepto bastante largo para que haya que recortarlo sí o sí", 50); got == "" {
		t.Fatal("recortar devolvió vacío")
	}
}
