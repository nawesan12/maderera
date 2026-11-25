package planilla

import (
	"archive/zip"
	"bytes"
	"fmt"
	"testing"
)

// Una lista de precios grande: 20.000 filas de 5 celdas, escrita con
// archive/zip (que usa descriptores de datos, como los programas que
// escriben el ZIP mientras comprimen).
func xlsxGrande(b *testing.B, filas int) []byte {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, err := w.Create("xl/worksheets/sheet1.xml")
	if err != nil {
		b.Fatal(err)
	}
	fmt.Fprint(f, `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>`)
	for i := 1; i <= filas; i++ {
		fmt.Fprintf(f, `<row r="%d"><c r="A%d" t="inlineStr"><is><t>SKU-%d</t></is></c><c r="B%d" t="inlineStr"><is><t>Fenólico %d mm</t></is></c><c r="C%d"><v>%d.5</v></c><c r="D%d"><v>%d.25</v></c><c r="F%d" s="0"><v>46269</v></c></row>`, i, i, i, i, i, i, i*100, i, i*90, i)
	}
	fmt.Fprint(f, `</sheetData></worksheet>`)
	if err := w.Close(); err != nil {
		b.Fatal(err)
	}
	return buf.Bytes()
}

func BenchmarkXlsxGrande(b *testing.B) {
	datos := xlsxGrande(b, 20000)
	b.SetBytes(int64(len(datos)))
	for b.Loop() {
		if p := LeerPlanilla(datos); p.Error != "" || len(p.Filas) != 20000 {
			b.Fatalf("%s %d", p.Error, len(p.Filas))
		}
	}
}
