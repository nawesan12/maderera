package pdf

import (
	"os/exec"
	"strings"
	"testing"
	"time"
)

// Lo que encontró el mes simulado en el remito impreso.

func TestCondicionDePagoDelRemito(t *testing.T) {
	casos := []struct {
		r    RemitoCompleto
		dice string
	}{
		// El chofer de un envío contra entrega sabe cuánto traer y cómo.
		{RemitoCompleto{Tipo: "envio", EstadoPago: "pendiente", MedioPago: "efectivo", SinCobrar: 495400}, "A cobrar $\u00a0495.400,00 · Efectivo"},
		{RemitoCompleto{Tipo: "envio", EstadoPago: "pendiente", MedioPago: "cuenta_corriente", SinCobrar: 0}, "Cuenta corriente"},
		// En el mostrador no hace falta la cifra.
		{RemitoCompleto{Tipo: "retiro", EstadoPago: "pendiente", MedioPago: "efectivo", SinCobrar: 495400}, "Pendiente de pago"},
		{RemitoCompleto{Tipo: "envio", EstadoPago: "pagado", MedioPago: "efectivo"}, "Pagado"},
	}
	for _, c := range casos {
		if got := CondicionDePago(c.r); got != c.dice {
			t.Errorf("%+v: %q, quería %q", c.r, got, c.dice)
		}
	}
}

func TestLeyendaYUnidadesDelRemito(t *testing.T) {
	if l := LeyendaDelRemito(nil); strings.Contains(l, "comprobante fiscal") {
		t.Errorf("sin factura manda a buscar el comprobante: %q", l)
	}
	if l := LeyendaDelRemito(&FacturaDelRemito{Etiqueta: "Factura B 0001-00000001"}); !strings.Contains(l, "comprobante fiscal") {
		t.Errorf("con factura: %q", l)
	}
	for _, c := range []struct {
		u    string
		n    float64
		dice string
		desc string
	}{{"placa", 1, "placa", ""}, {"placa", 25, "placas", ""}, {"rollo", 6, "rollos", ""}, {"unidad", 20, "u.", ""}, {"par", 2, "pares", ""},
		{"metro_cuadrado", 3, "m²", ""}, {"litro", 2, "u.", "Laca Poliuretánica — 4 litros — Brillante"}, {"litro", 2, "l", "Thinner suelto"},
		{"pasada", 1, "corte", ""}, {"pasada", 12, "cortes", ""}} {
		if got := UnidadPara(c.u, c.n, c.desc); got != c.dice {
			t.Errorf("%v %s: %q, quería %q", c.n, c.u, got, c.dice)
		}
	}
}

// El remito de un envío con algo pendiente dice «Falta entregar» y no que
// la mercadería queda guardada; el renglón cortado dice según qué corte.
func TestElRemitoDeUnEnvioParcial(t *testing.T) {
	if _, err := exec.LookPath("pdftotext"); err != nil {
		t.Skip("falta pdftotext")
	}
	r := RemitoCompleto{Numero: "REM-0008", Tipo: "envio", Estado: "preparada", CreatedAt: time.Now(), PedidoNumero: "PED-1050",
		ClienteNombre: "Constructora", EstadoPago: "pendiente", MedioPago: "efectivo", SinCobrar: 1000,
		Lineas:     []LineaDelRemito{{Descripcion: "MDF 18 mm", Unidad: "placa", Cantidad: 3, Corte: "Cortado según CRT-13: 14 piezas de 2 placas · 1 entera"}},
		Pendientes: []PendienteDelRemito{{Descripcion: "Placa de yeso", Unidad: "placa", Pendiente: 40}}}
	b, err := Remito(DatosRemito{Remito: r}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	texto := textoDelPDF(t, b)
	for _, quiere := range []string{"FALTA ENTREGAR", "40 placas · Placa de yeso", "Cortado según CRT-13", "A cobrar $"} {
		if !strings.Contains(texto, quiere) {
			t.Errorf("falta %q en:\n%s", quiere, texto)
		}
	}
	if strings.Contains(texto, "queda guardada") {
		t.Errorf("un envío dice que la mercadería queda guardada")
	}
}

func textoDelPDF(t *testing.T, b []byte) string {
	t.Helper()
	cmd := exec.Command("pdftotext", "-layout", "-", "-")
	cmd.Stdin = strings.NewReader(string(b))
	out, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}
