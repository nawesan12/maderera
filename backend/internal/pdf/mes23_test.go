package pdf

import (
	"strings"
	"testing"
	"time"
)

// «Lista Lista profesional» (mes simulado, M2S3-093) y la lata de 4 litros
// que el presupuesto vendía como «2 l» (M2S3-074).
func TestTituloYUnidadDelMes(t *testing.T) {
	if got := TituloDeLista("Lista profesional"); got != "Lista profesional" {
		t.Errorf("título: %q", got)
	}
	if got := TituloDeLista("Gremio"); got != "Lista Gremio" {
		t.Errorf("título: %q", got)
	}
	if got := Unidad(UnidadDeVenta("litro", "Laca Poliuretánica - 4 litros")); got != "u." {
		t.Errorf("unidad de la lata: %q", got)
	}
}

// Mes 23: el detalle del e-Cheq en la orden de pago va entero, en dos
// renglones si hace falta; se cortaba en «al 30/...».
func TestOrdenDePagoConElDetalleEntero(t *testing.T) {
	b, err := OrdenDePago(DatosOrdenDePago{Fecha: time.Date(2026, 11, 27, 15, 0, 0, 0, time.UTC), Total: 53000, Neto: 53000,
		Medios: []MedioDeLaOrden{{Medio: "e-Cheq", Detalle: "N.º 90000001 · Sim Banco Galicia y Buenos Aires · al 30/12/2026", Importe: 53000}}})
	if err != nil {
		t.Fatal(err)
	}
	texto := strings.Join(strings.Fields(textoDelPDF(t, b)), " ")
	if !strings.Contains(texto, "30/12/2026") || strings.Contains(texto, "...") {
		t.Errorf("el detalle se corta: %s", texto)
	}
}
