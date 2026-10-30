package pdf

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestActualizarGoldenComprobante reescribe los PDF del golden del
// comprobante que no son A con lo que arma Go. Lo del TS dejó de ser la referencia en dos
// cosas, a propósito: en la B y la C el precio unitario es el final (con
// IVA), y la B a consumidor final lleva la leyenda de la ley 27.743. Correr
// solo después de revisar a ojo el cambio:
//
//	PDF_ACTUALIZAR_COMPROBANTE=1 go test ./internal/pdf -run TestActualizarGoldenComprobante
func TestActualizarGoldenComprobante(t *testing.T) {
	if os.Getenv("PDF_ACTUALIZAR_COMPROBANTE") == "" {
		t.Skip("solo con PDF_ACTUALIZAR_COMPROBANTE=1")
	}
	casos, _ := filepath.Glob(filepath.Join(dirGolden, "comprobante", "*.json"))
	for _, c := range casos {
		crudo, err := os.ReadFile(c)
		if err != nil {
			t.Fatal(err)
		}
		var caso casoGolden
		if err := json.Unmarshal(crudo, &caso); err != nil {
			t.Fatal(err)
		}
		// La A no cambió: se queda con el PDF del TS.
		var d DatosComprobante
		if err := json.Unmarshal(caso.Datos, &d); err != nil {
			t.Fatal(err)
		}
		if comprobanteLetra(d.Comprobante.Tipo) == "A" {
			continue
		}
		b, err := decodificar(Comprobante)(caso.Datos, caso.Ahora)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(strings.TrimSuffix(c, ".json")+".pdf", b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("%d comprobantes reescritos", len(casos))
}

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
}
