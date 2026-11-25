package planilla

import (
	"archive/zip"
	"bytes"
	"reflect"
	"testing"
)

// xml:space="preserve" (tanda 13): «  10 x 20  » con preserve sale con sus
// espacios, en los textos compartidos y en los inlineStr; sin preserve, se
// recorta como siempre.
func TestEspaciosDeXmlSpacePreserve(t *testing.T) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	poner := func(nombre, xml string) {
		f, err := w.Create(nombre)
		if err != nil {
			t.Fatal(err)
		}
		f.Write([]byte(xml))
	}
	poner("xl/sharedStrings.xml", `<sst>`+
		`<si><t xml:space="preserve">  10 x 20  </t></si>`+
		`<si><t>  10 x 20  </t></si>`+
		`<si><r><t xml:space="preserve">Placa </t></r><r><t>18 mm</t></r></si>`+
		`<si><x:t xml:space='preserve'>	tab</x:t></si>`+
		`</sst>`)
	poner("xl/worksheets/sheet1.xml", `<worksheet><sheetData>`+
		`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>`+
		`<row r="2"><c r="A2" t="inlineStr"><is><t xml:space="preserve">  10 x 20  </t></is></c>`+
		`<c r="B2" t="inlineStr"><is><t>  10 x 20  </t></is></c>`+
		`<c r="C2" t="inlineStr"><is><t xml:space="preserve">   </t></is></c></row>`+
		`</sheetData></worksheet>`)
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	filas, _, err := LeerXlsx(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	esperado := [][]string{
		{"  10 x 20  ", "10 x 20", "Placa 18 mm", "\ttab"},
		{"  10 x 20  ", "10 x 20", "   "},
	}
	if !reflect.DeepEqual(filas, esperado) {
		t.Fatalf("%q\nse esperaba %q", filas, esperado)
	}
}
