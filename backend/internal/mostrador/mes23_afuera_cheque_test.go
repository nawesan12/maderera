package mostrador

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/reportes"
	"mjbj/internal/ventas"
)

// Mes 23 (PED-1128): la venta cobrada con cheque y devuelta «por afuera»
// sale del Banco (el cheque sigue en la cartera). La pantalla decía «Otro
// medio · por el medio de pago» y la nota «Cheque»: los dos dicen ahora
// Transferencia, lo mismo que el asiento.
func TestLaDevolucionPorAfueraDeUnChequeDiceTransferencia(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "afuera-cheque-dice@prueba.test", VentaPedida{MedioPago: ventas.Cheque, ContactoNombre: "Cheque Afuera",
		Lineas: placas(e, 10, 100), Pagos: []ventas.PagoDeVenta{{Medio: ventas.Cheque, Importe: 1000, Cheque: chequeDePago("55501234")}}})
	datos, err := c.fac.ParaDevolver(context.Background(), c.factura)
	if err != nil || datos == nil {
		t.Fatalf("datos: %v %+v", err, datos)
	}
	if datos.AfueraPor != "transferencia" {
		t.Errorf("vuelve por %q, quería transferencia", datos.AfueraPor)
	}
	d := c.afuera(t, 2)
	nota, err := c.fac.Obtener(context.Background(), d.NotaID)
	if err != nil {
		t.Fatal(err)
	}
	if nota.Devolucion == nil || len(nota.Devolucion.Partes) != 1 || nota.Devolucion.Partes[0].Medio != "transferencia" {
		t.Errorf("la nota dice %+v", nota.Devolucion)
	}
	var reintegro *reportes.Asiento
	asientos := e.asientosDeTodo(t)
	for i, a := range asientos {
		if strings.HasPrefix(a.Concepto, "Reintegro parcial Factura") {
			reintegro = &asientos[i]
		}
	}
	if reintegro == nil || reintegro.Renglones[1].Cuenta != reportes.Cuentas.Banco {
		t.Errorf("reintegro: %+v", reintegro)
	}

	// Mixta, débito y cheque: son dos medios, «Otro medio».
	m := e.vendidaYFacturada(t, "afuera-mixta-dice@prueba.test", VentaPedida{MedioPago: ventas.Cheque, ContactoNombre: "Mixta Afuera",
		Lineas: placas(e, 10, 100), Pagos: []ventas.PagoDeVenta{{Medio: ventas.Debito, Importe: 500}, {Medio: ventas.Cheque, Importe: 500, Cheque: chequeDePago("55509876")}}})
	if datos, err := m.fac.ParaDevolver(context.Background(), m.factura); err != nil || datos.AfueraPor != "" {
		t.Errorf("mixta: %v %+v", err, datos)
	}
}
