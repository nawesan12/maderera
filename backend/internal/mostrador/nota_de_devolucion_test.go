package mostrador

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/ventas"
)

// La nota de una devolución por afuera dice cómo salió la plata (tenía
// «Cobros» vacío, M2S3-046) y qué factura anula en parte (M3S3-006).
func TestLaNotaDeUnaDevolucionDiceLaPlataYLaFactura(t *testing.T) {
	e := armar(t)
	c := e.vendidaYFacturada(t, "admin@prueba.test", VentaPedida{MedioPago: ventas.Debito, Lineas: placas(e, 4, 1000)})
	d := c.afuera(t, 1)
	nota, err := c.fac.Obtener(context.Background(), d.NotaID)
	if err != nil {
		t.Fatal(err)
	}
	if nota.Devolucion == nil || nota.Devolucion.Destino != "afuera" || nota.Devolucion.Importe != 1000 || len(nota.Devolucion.Partes) != 1 ||
		nota.Devolucion.Partes[0].Importe != 1000 {
		t.Fatalf("devolución: %+v", nota.Devolucion)
	}
	if nota.Asociado == nil || !strings.HasPrefix(*nota.Asociado, "Anula parcialmente: Factura ") {
		t.Fatalf("asociado: %v", nota.Asociado)
	}
	pdf, _, err := c.fac.Pdf(context.Background(), nota)
	if err != nil || len(pdf) == 0 {
		t.Fatalf("pdf: %v", err)
	}
}
