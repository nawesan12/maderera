package correo

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"fmt"
	"strings"
	"testing"
)

// pdfDePrueba arma un PDF mínimo con una línea de texto por renglón, como
// los que exportan los programas de despiece y los home banking.
func pdfDePrueba(lineas []string, comprimido bool) []byte {
	var c strings.Builder
	c.WriteString("BT /F1 12 Tf 50 800 Td ")
	for _, l := range lineas {
		l = strings.NewReplacer(`\`, `\\`, "(", `\(`, ")", `\)`).Replace(l)
		// Como los PDF de verdad: WinAnsi, las tildes en octal.
		var w strings.Builder
		for _, r := range l {
			if r >= 0x80 && r < 0x100 {
				fmt.Fprintf(&w, "\\%03o", r)
			} else {
				w.WriteRune(r)
			}
		}
		fmt.Fprintf(&c, "(%s) Tj 0 -16 Td ", w.String())
	}
	c.WriteString("ET")
	contenido := []byte(c.String())
	filtro := ""
	if comprimido {
		var b bytes.Buffer
		z := zlib.NewWriter(&b)
		_, _ = z.Write(contenido)
		_ = z.Close()
		contenido = b.Bytes()
		filtro = " /Filter /FlateDecode"
	}
	var out bytes.Buffer
	out.WriteString("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n")
	fmt.Fprintf(&out, "4 0 obj << /Length %d%s >>\nstream\n", len(contenido), filtro)
	out.Write(contenido)
	out.WriteString("\nendstream\nendobj\n%%EOF\n")
	return out.Bytes()
}

func xlsxDePrueba(filas [][]string) []byte {
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	var hoja strings.Builder
	hoja.WriteString(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	var compartidas []string
	for i, f := range filas {
		fmt.Fprintf(&hoja, `<row r="%d">`, i+1)
		for j, c := range f {
			ref := fmt.Sprintf("%c%d", 'A'+j, i+1)
			if _, err := fmt.Sscanf(c, "%f", new(float64)); err == nil && !strings.ContainsAny(c, " -") {
				fmt.Fprintf(&hoja, `<c r="%s"><v>%s</v></c>`, ref, c)
			} else {
				fmt.Fprintf(&hoja, `<c r="%s" t="s"><v>%d</v></c>`, ref, len(compartidas))
				compartidas = append(compartidas, c)
			}
		}
		hoja.WriteString(`</row>`)
	}
	hoja.WriteString(`</sheetData></worksheet>`)
	w, _ := z.Create("xl/worksheets/sheet1.xml")
	_, _ = w.Write([]byte(hoja.String()))
	var sst strings.Builder
	sst.WriteString(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`)
	for _, s := range compartidas {
		fmt.Fprintf(&sst, "<si><t>%s</t></si>", s)
	}
	sst.WriteString("</sst>")
	w, _ = z.Create("xl/sharedStrings.xml")
	_, _ = w.Write([]byte(sst.String()))
	_ = z.Close()
	return b.Bytes()
}

func TestAdjuntosQueSeConectan(t *testing.T) {
	e := &ERP{panel: "https://mjbj.com.ar"}
	ficha := &Ficha{Nombre: "Carpintería Pérez", Saldo: 486300, Enlaces: map[string]string{"ficha": "https://mjbj.com.ar/admin/clientes/1", "presupuesto": "https://mjbj.com.ar/admin/presupuestos/nuevo?cliente=1"}}

	despiece := pdfDePrueba([]string{"Despiece cocina - version 2", "Pieza Cant. Largo Ancho Material",
		"Lateral bajo mesada 4 700 560 Melamina blanca 18", "Estante 6 560 350 Melamina blanca 18", "Fondo 4 1180 700 Fibroplus blanco 3"}, true)
	c := e.analizarAdjunto("despiece-cocina-v2.pdf", "application/pdf", despiece, ficha)
	if c.Tipo != "despiece" || len(c.Piezas) != 3 || c.Piezas[0] != (Pieza{Nombre: "Lateral bajo mesada", Cantidad: 4, Largo: 700, Ancho: 560, Material: "Melamina blanca 18"}) {
		t.Fatalf("despiece en PDF: %+v", c)
	}
	if !strings.Contains(c.Detalle, "14 piezas") || c.Acciones[0].Enlace != ficha.Enlaces["presupuesto"] {
		t.Errorf("despiece: %q %+v", c.Detalle, c.Acciones)
	}

	planilla := xlsxDePrueba([][]string{{"Módulo", "Pieza", "Cant.", "Largo", "Ancho", "Tapacanto"}, {"Bajo 1", "Lateral", "2", "700", "560", "1 lado largo"}, {"Bajo 1", "Base", "1", "1164", "560", "frente"}})
	c = e.analizarAdjunto("medidas-modulos.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", planilla, nil)
	if c.Tipo != "despiece" || len(c.Piezas) != 2 || c.Piezas[1].Largo != 1164 || c.Piezas[1].Nombre != "Base" {
		t.Fatalf("despiece en planilla: %+v", c)
	}

	factura := pdfDePrueba([]string{"FACTURA A", "Faplac S.A. CUIT 30-50012345-6", "Comprobante Nro 0003-00012345", "Subtotal $ 1.000.000,00", "IVA 21% $ 210.000,00", "Total $ 1.210.000,00"}, false)
	c = e.analizarAdjunto("factura-0003-00012345.pdf", "application/pdf", factura, nil)
	if c.Tipo != "factura" {
		t.Fatalf("factura: %+v", c)
	}
	datos := fmt.Sprint(c.Datos)
	for _, quiero := range []string{"30-50012345-6", "0003-00012345", "$ 1.210.000"} {
		if !strings.Contains(datos, quiero) {
			t.Errorf("la factura no dice %q: %s", quiero, datos)
		}
	}

	comprobante := pdfDePrueba([]string{"Comprobante de transferencia", "Fecha: 24/10/2026", "Importe: $ 250.000,00", "CBU destino 0140030501234567890123", "Número de operación: 98765432"}, true)
	c = e.analizarAdjunto("comprobante.pdf", "application/pdf", comprobante, ficha)
	if c.Tipo != "comprobante" || !strings.Contains(fmt.Sprint(c.Datos), "$ 250.000") || !strings.Contains(fmt.Sprint(c.Datos), "98765432") || c.Acciones[0].Enlace != ficha.Enlaces["ficha"] {
		t.Fatalf("comprobante: %+v", c)
	}

	lista := xlsxDePrueba([][]string{{"Código", "Producto", "Precio"}, {"MB18", "Melamina blanca 18", "53015"}, {"MDF18", "MDF 18", "41200"}, {"F18", "Fenólico 18", "48900"}, {"T24", "Tirante 2x4", "9850"}})
	c = e.analizarAdjunto("lista-noviembre.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", lista, nil)
	if c.Tipo != "lista" || !strings.Contains(c.Detalle, "4 productos") {
		t.Fatalf("lista: %+v", c)
	}

	if c := e.analizarAdjunto("foto.jpg", "image/jpeg", []byte{0xff, 0xd8}, nil); c.Tipo != "" {
		t.Errorf("una foto no se conecta: %+v", c)
	}
}
