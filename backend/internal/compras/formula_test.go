package compras

import (
	"strings"
	"testing"
)

// El libro IVA de compras lleva el nombre del proveedor tal como se cargó:
// sin fórmulas para Excel.
func TestLibroIvaComprasSinFormulas(t *testing.T) {
	csv := CsvLibroIva([]RenglonLibro{{Proveedor: `=HYPERLINK("http://x")`, Tipo: "factura_a"}}, TotalesLibro{})
	if !strings.Contains(csv, `"'=HYPERLINK(""http://x"")"`) {
		t.Fatalf("el proveedor salió como fórmula:\n%s", csv)
	}
}
