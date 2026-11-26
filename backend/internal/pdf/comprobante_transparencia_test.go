package pdf

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// La B a consumidor final: la leyenda de la ley 27.743 con el IVA contenido,
// y el precio unitario final, que por la cantidad da el subtotal.
func TestComprobanteBTransparenciaFiscal(t *testing.T) {
	herramientas(t)
	cp := ComprobantePdf{Tipo: "factura_b", PuntoVenta: 3, Numero: 1, ReceptorNombre: "Juan", ReceptorCondicionIva: "consumidor_final",
		Neto: "20000.00", Iva21: "4200.00", Iva105: "0.00", Iva27: "0.00", Exento: "0.00", TributosTotal: "0.00", Total: "24200.00",
		FechaEmision: time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC), Estado: "emitida",
		Items: []ItemComprobante{{Descripcion: "Fenólico", Unidad: "unidad", Cantidad: "2", PrecioUnitario: "10000.0000", AlicuotaIva: "21.00", Subtotal: "24200.00"}}}
	texto := func(cp ComprobantePdf) string {
		b, err := Comprobante(DatosComprobante{Comprobante: cp}, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		ruta := filepath.Join(t.TempDir(), "c.pdf")
		if err := os.WriteFile(ruta, b, 0o644); err != nil {
			t.Fatal(err)
		}
		return extraerTexto(t, ruta)
	}
	s := texto(cp)
	for _, quiero := range []string{"Ley 27.743", "IVA contenido: $ 4.200", "Otros impuestos nacionales indirectos: $ 0", "$ 12.100"} {
		if !strings.Contains(s, quiero) {
			t.Errorf("falta %q en:\n%s", quiero, s)
		}
	}
	if strings.Contains(s, "$ 10.000") {
		t.Error("el precio unitario impreso es el neto")
	}
	// A un inscripto (A) no va la leyenda, y el unitario es el neto.
	cp.Tipo, cp.ReceptorCondicionIva = "factura_a", "responsable_inscripto"
	if s := texto(cp); strings.Contains(s, "Ley 27.743") || !strings.Contains(s, "$ 10.000") {
		t.Errorf("la A:\n%s", s)
	}
	// Con el neto del renglón, la fila de la A cierra: 2 × $ 10.000 =
	// $ 20.000, no los $ 24.200 con IVA (H080). Y la condición de venta.
	cp.Items[0].Neto = "20000.00"
	cp.CondicionVenta, cp.Pedido = "Contado · Efectivo", "PED-1000"
	s = texto(cp)
	for _, quiero := range []string{"$ 20.000", "Condición de venta: Contado · Efectivo", "Pedido PED-1000"} {
		if !strings.Contains(s, quiero) {
			t.Errorf("falta %q en la A:\n%s", quiero, s)
		}
	}
	if strings.Count(s, "$ 24.200") != 1 {
		t.Errorf("el subtotal de la fila de la A va neto:\n%s", s)
	}
}
